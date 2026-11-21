import type { AgentHost, AgentRunResult, AgentWriteBackResult, PendingAgentWrite } from "agent";
import { mediaOfName, runPrefix, type RunManifest } from "./agent-workspace";
import { addVersion, createDocument, listDocuments } from "./documents";
import { githubAppConfig, installationToken, openPullRequest, type RepoFileChange } from "./github-app";

export const DEFAULT_AGENT_MAX_USD = 2;

function maxBudgetUsd(env: Env): number {
  const raw = Number(env.FUDO_AGENT_MAX_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_AGENT_MAX_USD;
}

/**
 * run_agent の実行先。キー・Container・書類の置き場が揃った配備だけで作る。
 * 揃わなければ undefined を返し、run_agent はモデルに見せない。
 */
export function agentHostFor(env: Env, userId: string): AgentHost | undefined {
  const bucket = env.DOCS;
  if (!env.ANTHROPIC_API_KEY?.trim() || env.FUDO_CONTAINERS !== "1" || !bucket) return undefined;
  const github = githubAppConfig(env);

  const discard = async (runId: string) => {
    const prefix = runPrefix(userId, runId);
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix, cursor });
      if (page.objects.length > 0) await bucket.delete(page.objects.map((row) => row.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  };

  return {
    async workspaces() {
      const documents = await listDocuments(bucket, userId);
      return {
        documents: documents.map((doc) => ({ docId: doc.docId, name: doc.name, version: doc.version })),
        repos: github ? [...github.repos] : []
      };
    },

    async run(request) {
      if (request.workspace.kind === "repo" && !github?.repos.includes(request.workspace.repo)) {
        return { ok: false, reason: "repo_denied", detail: { constraint: `${request.workspace.repo} は許可リスト外` } };
      }
      const stub = env.USER_SANDBOX.get(env.USER_SANDBOX.idFromName(userId));
      const response = await stub.fetch("https://sandbox/agent", {
        method: "POST",
        body: JSON.stringify({ runId: crypto.randomUUID(), userId, request, maxBudgetUsd: maxBudgetUsd(env) })
      });
      return (await response.json()) as AgentRunResult;
    },

    async writeBack(pending) {
      const manifestObject = await bucket.get(`${runPrefix(userId, pending.runId)}manifest.json`);
      if (!manifestObject) {
        return { ok: false, reason: "staging_expired", detail: { constraint: "変更の複製が残っていない" } };
      }
      const manifest = JSON.parse(await manifestObject.text()) as RunManifest;
      const written = manifest.source.kind === "files"
        ? await writeDocuments(bucket, userId, manifest, manifest.source)
        : await writePullRequest(env, bucket, userId, pending, manifest, manifest.source);
      if (written.ok) await discard(pending.runId);
      return written;
    },

    discard
  };
}

async function stagedBytes(bucket: R2Bucket, userId: string, runId: string, path: string): Promise<ArrayBuffer | null> {
  const object = await bucket.get(`${runPrefix(userId, runId)}files/${path}`);
  return object ? object.arrayBuffer() : null;
}

async function writeDocuments(
  bucket: R2Bucket,
  userId: string,
  manifest: RunManifest,
  source: Extract<RunManifest["source"], { kind: "files" }>
): Promise<AgentWriteBackResult> {
  const done: string[] = [];
  for (const change of manifest.changes) {
    if (change.status === "deleted") continue;
    const bytes = await stagedBytes(bucket, userId, manifest.runId, change.path);
    if (!bytes) return { ok: false, reason: "staging_expired", detail: { constraint: `${change.path} の複製が無い` } };
    const origin = source.files[change.path];
    const saved = origin
      ? await addVersion(bucket, userId, origin.docId, bytes)
      : await createDocument(bucket, userId, { name: change.path, media: mediaOfName(change.path), bytes });
    if (!saved.ok) return { ok: false, reason: saved.reason, detail: { constraint: `${change.path}: ${saved.reason}` } };
    done.push(origin ? `${saved.ref.name} v${saved.ref.version}` : `${saved.ref.name}（新規）`);
  }
  return { ok: true, summary: `書類に新しい版を保存した: ${done.join("、")}。元の版は残っている。` };
}

async function writePullRequest(
  env: Env,
  bucket: R2Bucket,
  userId: string,
  pending: PendingAgentWrite,
  manifest: RunManifest,
  source: Extract<RunManifest["source"], { kind: "repo" }>
): Promise<AgentWriteBackResult> {
  const config = githubAppConfig(env);
  if (!config) return { ok: false, reason: "github_unconfigured", detail: { constraint: "GitHub App が未設定" } };
  const token = await installationToken(config, source.repo);
  if (!token.ok) return token;
  const files: RepoFileChange[] = [];
  for (const change of manifest.changes) {
    if (change.status === "deleted") {
      files.push({ path: change.path, mode: change.mode, content: null });
      continue;
    }
    const bytes = await stagedBytes(bucket, userId, manifest.runId, change.path);
    if (!bytes) return { ok: false, reason: "staging_expired", detail: { constraint: `${change.path} の複製が無い` } };
    files.push({ path: change.path, mode: change.mode, content: bytes });
  }
  const title = manifest.request.prompt.split("\n")[0]!.slice(0, 72);
  const pr = await openPullRequest(token.token, {
    repo: source.repo,
    base: source.branch,
    baseSha: source.sha,
    branch: `fudo/agent-${manifest.runId.slice(0, 8)}`,
    title,
    body: `${pending.result}\n\n---\nfudo の run_agent（${pending.agent}）が作成。起点 ${source.sha.slice(0, 7)}。`,
    files
  });
  if (!pr.ok) return pr;
  return { ok: true, summary: `${source.repo} に PR を出した。`, url: pr.url };
}
