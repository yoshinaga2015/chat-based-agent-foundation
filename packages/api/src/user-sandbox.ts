import { DurableObject } from "cloudflare:workers";
import {
  AGENT_DIFF_CHARS,
  claudePrintArgv,
  parseClaudePrintStdout,
  type AgentChange,
  type AgentRunRequest,
  type AgentRunResult
} from "agent";
import { ANTHROPIC_HOST, SANDBOX_KEY_PLACEHOLDER } from "./agent-egress";
import {
  MAX_CHANGES,
  WORKSPACE_DIR,
  parseBinaryPaths,
  parseModes,
  parseNameStatus,
  runPrefix,
  workspaceNames,
  type RunManifest,
  type StagedChange
} from "./agent-workspace";
import { readDocument } from "./documents";
import { githubAppConfig, installationToken, repoTarball, resolveBranch } from "./github-app";

export type SandboxExecResult = {
  ok: true;
  stdout: string;
  stderr: string;
  exitCode: number;
} | {
  ok: false;
  reason: string;
};

export type AgentJob = {
  runId: string;
  userId: string;
  request: AgentRunRequest;
  maxBudgetUsd: number;
};

const CA_PATH = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
const AGENT_USER = "agent";
const AGENT_HOME = "/home/agent";
const decoder = new TextDecoder();

type Fail = { ok: false; reason: string; detail?: { constraint: string } };

function fail(reason: string, constraint?: string): Fail {
  return constraint ? { ok: false, reason, detail: { constraint } } : { ok: false, reason };
}

function text(buffer: ArrayBuffer | string | undefined): string {
  if (buffer === undefined) return "";
  return typeof buffer === "string" ? buffer : decoder.decode(buffer);
}

/** cloudflare.config.ts の userSandbox.images のキー。 */
const SANDBOX_IMAGE = "debian";

/** start() の image は images のキーではなく実イメージ参照を取る。 */
async function startContainer(container: DurableObjectContainer): Promise<void> {
  const image = container.images?.[SANDBOX_IMAGE];
  if (!image) throw new Error(`container_image_missing:${SANDBOX_IMAGE}`);
  await container.start({ image, entrypoint: ["sleep", "infinity"], enableInternet: false });
}

/**
 * ユーザー単位の Linux Container。外向きの通信は無効にし、api.anthropic.com だけを
 * outbound handler（AnthropicEgress）経由で通す。本物のキーはコンテナに入らない。
 */
export class UserSandbox extends DurableObject {
  private async boot(): Promise<DurableObjectContainer | Fail> {
    const container = this.ctx.container;
    if (!container) return fail("container_unconfigured");
    // 起動前に横取りを張る。CA はコンテナ起動時にだけ置かれる。
    await container.interceptOutboundHttps(ANTHROPIC_HOST, this.ctx.exports.AnthropicEgress!({ props: {} }));
    if (!container.running) await startContainer(container);
    const ca = await (await container.exec(["test", "-f", CA_PATH])).output();
    if (ca.exitCode !== 0) {
      await container.destroy();
      await startContainer(container);
    }
    return container;
  }

  async exec(argv: string[]): Promise<SandboxExecResult> {
    try {
      const container = await this.boot();
      if ("ok" in container) return container;
      const output = await (await container.exec(argv, { user: AGENT_USER, cwd: AGENT_HOME })).output();
      return {
        ok: true,
        stdout: text(output.stdout).slice(0, 8_000),
        stderr: text(output.stderr).slice(0, 2_000),
        exitCode: output.exitCode
      };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "exec_failed" };
    }
  }

  async runAgent(job: AgentJob): Promise<AgentRunResult> {
    if (!this.env.ANTHROPIC_API_KEY) return fail("agent_key_unset", "ANTHROPIC_API_KEY が未設定");
    const bucket = this.env.DOCS;
    if (!bucket) return fail("docs_unconfigured", "書類の置き場（DOCS）が無い");
    try {
      const container = await this.boot();
      if ("ok" in container) return container;
      const sh = async (script: string, options: ContainerExecOptions = {}, args: string[] = []) =>
        (await container.exec(["sh", "-c", script, "sh", ...args], options)).output();
      const asAgent: ContainerExecOptions = {
        user: AGENT_USER,
        cwd: WORKSPACE_DIR,
        env: { HOME: AGENT_HOME, PATH: "/usr/local/bin:/usr/bin:/bin" }
      };

      const reset = await sh(`rm -rf ${WORKSPACE_DIR} && mkdir -p ${WORKSPACE_DIR} && chown ${AGENT_USER}:${AGENT_USER} ${WORKSPACE_DIR}`);
      if (reset.exitCode !== 0) return fail("workspace_failed", text(reset.stderr).slice(0, 200));

      const source = await this.materialize(container, job, bucket);
      if (!source.ok) return source;

      const baseline = await sh(
        "git init -q && git add -A && git -c user.name=fudo -c user.email=fudo@localhost commit -qm base --allow-empty",
        asAgent
      );
      if (baseline.exitCode !== 0) return fail("workspace_failed", text(baseline.stderr).slice(0, 200));

      const process = await container.exec(claudePrintArgv(job.request, job.maxBudgetUsd), {
        ...asAgent,
        env: {
          ...asAgent.env,
          ANTHROPIC_API_KEY: SANDBOX_KEY_PLACEHOLDER,
          NODE_EXTRA_CA_CERTS: CA_PATH,
          DISABLE_AUTOUPDATER: "1",
          DISABLE_TELEMETRY: "1",
          DISABLE_ERROR_REPORTING: "1",
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1"
        }
      });
      const timer = setTimeout(() => process.kill(9), job.request.timeoutMs);
      const output = await process.output().finally(() => clearTimeout(timer));
      const parsed = parseClaudePrintStdout(text(output.stdout));
      if (!parsed.ok) {
        const stderr = text(output.stderr).trim().slice(0, 300);
        const killed = output.exitCode === 137 ? "時間切れで止めた" : "";
        return fail(parsed.reason, [killed, parsed.result.slice(0, 300), stderr].filter(Boolean).join(" / ") || `exit ${output.exitCode}`);
      }

      if (job.request.workspace.kind === "none") {
        return { ok: true, result: parsed.result, exitCode: output.exitCode, costUsd: parsed.costUsd, changes: [] };
      }
      const collected = await this.collect(container, asAgent, job, bucket, source.manifestSource);
      if (!collected.ok) return collected;
      const note = collected.dropped.length > 0
        ? `\n\n（書き戻さない変更: ${collected.dropped.join("、")}）`
        : "";
      return {
        ok: true,
        result: `${parsed.result}${note}`,
        exitCode: output.exitCode,
        costUsd: parsed.costUsd,
        changes: collected.changes,
        ...(collected.changes.length > 0 ? { runId: job.runId } : {})
      };
    } catch (error) {
      return fail("sandbox_failed", error instanceof Error ? error.message : String(error));
    }
  }

  private async materialize(
    container: DurableObjectContainer,
    job: AgentJob,
    bucket: R2Bucket
  ): Promise<{ ok: true; manifestSource: RunManifest["source"] | null } | Fail> {
    const workspace = job.request.workspace;
    const write = async (path: string, body: ReadableStream) =>
      (await container.exec(["sh", "-c", 'cat > "$1"', "sh", `${WORKSPACE_DIR}/${path}`], { user: AGENT_USER, stdin: body })).output();

    if (workspace.kind === "none") return { ok: true, manifestSource: null };

    if (workspace.kind === "files") {
      const docs: { docId: string; version: number; name: string; bytes: ArrayBuffer }[] = [];
      for (const docId of workspace.docIds) {
        const doc = await readDocument(bucket, job.userId, docId);
        if (!doc) return fail("document_not_found", `書類 ${docId} が無い`);
        docs.push({ docId, version: doc.ref.version, name: doc.ref.name, bytes: doc.bytes });
      }
      const names = workspaceNames(docs.map((doc) => doc.name));
      const files: Record<string, { docId: string; version: number }> = {};
      for (const [index, doc] of docs.entries()) {
        const name = names[index]!;
        const written = await write(name, new Response(doc.bytes).body!);
        if (written.exitCode !== 0) return fail("workspace_failed", text(written.stderr).slice(0, 200));
        files[name] = { docId: doc.docId, version: doc.version };
      }
      return { ok: true, manifestSource: { kind: "files", files } };
    }

    const config = githubAppConfig(this.env);
    if (!config) return fail("github_unconfigured", "GitHub App が未設定");
    const token = await installationToken(config, workspace.repo);
    if (!token.ok) return token;
    const head = await resolveBranch(token.token, workspace.repo, workspace.ref);
    if (!head.ok) return head;
    const tarball = await repoTarball(token.token, workspace.repo, head.sha);
    if (!tarball.ok) return tarball;
    const extracted = await (
      await container.exec(["tar", "-xz", "--strip-components=1", "-C", WORKSPACE_DIR], { user: AGENT_USER, stdin: tarball.body })
    ).output();
    if (extracted.exitCode !== 0) return fail("workspace_failed", text(extracted.stderr).slice(0, 200));
    return { ok: true, manifestSource: { kind: "repo", repo: workspace.repo, branch: head.branch, sha: head.sha } };
  }

  private async collect(
    container: DurableObjectContainer,
    asAgent: ContainerExecOptions,
    job: AgentJob,
    bucket: R2Bucket,
    source: RunManifest["source"] | null
  ): Promise<{ ok: true; changes: AgentChange[]; dropped: string[] } | Fail> {
    if (!source) return { ok: true, changes: [], dropped: [] };
    const git = async (args: string[]) => (await container.exec(["git", ...args], asAgent)).output();
    const added = await git(["add", "-A"]);
    if (added.exitCode !== 0) return fail("collect_failed", text(added.stderr).slice(0, 200));
    const names = parseNameStatus(text((await git(["diff", "--cached", "--name-status", "-z", "--no-renames"])).stdout));
    const binary = parseBinaryPaths(text((await git(["diff", "--cached", "--numstat", "-z", "--no-renames"])).stdout));
    const modes = parseModes(text((await git(["ls-files", "-s", "-z"])).stdout));

    const dropped: string[] = [];
    const kept = names.filter((row) => {
      if (source.kind !== "files") return true;
      if (row.status === "deleted") {
        dropped.push(`${row.path}（削除）`);
        return false;
      }
      if (row.path.includes("/")) {
        dropped.push(`${row.path}（フォルダ内）`);
        return false;
      }
      return true;
    });
    if (kept.length > MAX_CHANGES) return fail("too_many_changes", `変更が${MAX_CHANGES}件を超えた`);

    const prefix = runPrefix(job.userId, job.runId);
    const changes: AgentChange[] = [];
    const staged: StagedChange[] = [];
    for (const row of kept) {
      const isBinary = binary.has(row.path);
      let diff: string | undefined;
      if (!isBinary) {
        const raw = text((await git(["diff", "--cached", "--no-color", "--no-renames", "--", row.path])).stdout);
        diff = raw.length > AGENT_DIFF_CHARS ? `${raw.slice(0, AGENT_DIFF_CHARS)}\n…` : raw;
      }
      let bytes: number | undefined;
      if (row.status !== "deleted") {
        const content = await (await container.exec(["cat", "--", row.path], asAgent)).output();
        if (content.exitCode !== 0) return fail("collect_failed", `${row.path} を読めない`);
        bytes = content.stdout.byteLength;
        await bucket.put(`${prefix}files/${row.path}`, content.stdout);
      }
      changes.push({ path: row.path, status: row.status, binary: isBinary, ...(diff !== undefined ? { diff } : {}), ...(bytes !== undefined ? { bytes } : {}) });
      staged.push({ path: row.path, status: row.status, mode: modes.get(row.path) ?? "100644" });
    }
    if (changes.length > 0) {
      const manifest: RunManifest = { runId: job.runId, userId: job.userId, request: job.request, changes: staged, source };
      await bucket.put(`${prefix}manifest.json`, JSON.stringify(manifest), { httpMetadata: { contentType: "application/json" } });
    }
    return { ok: true, changes, dropped };
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return new Response("method", { status: 405 });
    const url = new URL(request.url);
    if (url.pathname === "/agent") {
      return Response.json(await this.runAgent((await request.json()) as AgentJob));
    }
    const body = (await request.json()) as { argv?: unknown };
    if (!Array.isArray(body.argv) || !body.argv.every((item) => typeof item === "string")) {
      return Response.json({ ok: false, reason: "invalid_argv" }, { status: 400 });
    }
    return Response.json(await this.exec(body.argv as string[]));
  }
}

export function sandboxCliRunner(env: Env, userId: string) {
  return async (argv: string[]) => {
    const id = env.USER_SANDBOX.idFromName(userId);
    const stub = env.USER_SANDBOX.get(id);
    const response = await stub.fetch("https://sandbox/exec", {
      method: "POST",
      body: JSON.stringify({ argv })
    });
    const body = (await response.json()) as SandboxExecResult;
    if (!body || typeof body !== "object") {
      return { ok: false as const, reason: "cli_unavailable", detail: { constraint: "サンドボックス応答が不正" } };
    }
    if (!body.ok) {
      return { ok: false as const, reason: body.reason, detail: { constraint: body.reason } };
    }
    return {
      ok: true as const,
      stdout: body.stdout,
      stderr: body.stderr,
      exitCode: body.exitCode
    };
  };
}
