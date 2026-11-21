import { describe, expect, it, vi } from "vitest";
import { SANDBOX_KEY_PLACEHOLDER, injectAnthropicKey } from "./agent-egress";
import { agentHostFor } from "./agent-host";
import { parseBinaryPaths, parseModes, parseNameStatus, runPrefix, workspaceNames, type RunManifest } from "./agent-workspace";
import { createDocument, listDocuments, listVersions, readDocument, safeDocName } from "./documents";
import { documentsRoute } from "./documents-route";
import { memoryBucket } from "./r2-fake";

const REAL_KEY = "sk-ant-api03-real-owner-key";

function anthropicRequest(headers: Record<string, string>, url = "https://api.anthropic.com/v1/messages"): Request {
  return new Request(url, { method: "POST", headers, body: JSON.stringify({ model: "x" }) });
}

describe("injectAnthropicKey", () => {
  it("置き換え用の値を本物のキーに差し替える", () => {
    const out = injectAnthropicKey(anthropicRequest({ "x-api-key": SANDBOX_KEY_PLACEHOLDER, authorization: "Bearer x" }), REAL_KEY);
    expect(out).toBeInstanceOf(Request);
    const request = out as Request;
    expect(request.headers.get("x-api-key")).toBe(REAL_KEY);
    expect(request.headers.get("authorization")).toBeNull();
    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("置き換え用の値が無い・別ホスト・/v1 以外は通さない", async () => {
    const wrongKey = injectAnthropicKey(anthropicRequest({ "x-api-key": "sk-ant-other" }), REAL_KEY) as Response;
    expect(wrongKey.status).toBe(403);
    const otherHost = injectAnthropicKey(
      anthropicRequest({ "x-api-key": SANDBOX_KEY_PLACEHOLDER }, "https://evil.example/v1/messages"),
      REAL_KEY
    ) as Response;
    expect(otherHost.status).toBe(403);
    const otherPath = injectAnthropicKey(
      anthropicRequest({ "x-api-key": SANDBOX_KEY_PLACEHOLDER }, "https://api.anthropic.com/api/oauth/token"),
      REAL_KEY
    ) as Response;
    expect(otherPath.status).toBe(403);
    expect(await wrongKey.text()).not.toContain(REAL_KEY);
  });

  it("キー未設定なら 503", () => {
    const out = injectAnthropicKey(anthropicRequest({ "x-api-key": SANDBOX_KEY_PLACEHOLDER }), undefined) as Response;
    expect(out.status).toBe(503);
  });
});

describe("documents", () => {
  it("名前はパス区切り・先頭ドット・制御文字を拒否", () => {
    expect(safeDocName("賃料表.xlsx")).toBe("賃料表.xlsx");
    expect(safeDocName("../a")).toBeNull();
    expect(safeDocName(".env")).toBeNull();
    expect(safeDocName("a\u0000b")).toBeNull();
  });

  it("一覧は最新版、版の一覧は古い版も残す", async () => {
    const bucket = memoryBucket();
    const created = await createDocument(bucket, "u1", { name: "rent.csv", media: "text/csv", bytes: new TextEncoder().encode("a,1").buffer });
    if (!created.ok) throw new Error("create");
    const { addVersion } = await import("./documents");
    await addVersion(bucket, "u1", created.ref.docId, new TextEncoder().encode("a,2").buffer);
    expect((await listDocuments(bucket, "u1")).map((doc) => doc.version)).toEqual([2]);
    expect((await listVersions(bucket, "u1", created.ref.docId)).map((doc) => doc.version)).toEqual([1, 2]);
    const v1 = await readDocument(bucket, "u1", created.ref.docId, 1);
    expect(new TextDecoder().decode(v1!.bytes)).toBe("a,1");
    expect(await listDocuments(bucket, "u2")).toEqual([]);
  });

  it("経路: 作成・一覧・取得", async () => {
    const bucket = memoryBucket();
    const env = { DOCS: bucket } as unknown as Env;
    const post = await documentsRoute(
      new Request("https://x/api/documents", {
        method: "POST",
        headers: { "x-filename": encodeURIComponent("メモ.txt"), "content-type": "text/plain" },
        body: "hello"
      }),
      new URL("https://x/api/documents"),
      env,
      "local"
    );
    expect(post.status).toBe(201);
    const { document } = (await post.json()) as { document: { docId: string } };
    const list = await documentsRoute(new Request("https://x/api/documents"), new URL("https://x/api/documents"), env, "local");
    expect(((await list.json()) as { documents: { name: string }[] }).documents[0]?.name).toBe("メモ.txt");
    const get = await documentsRoute(
      new Request(`https://x/api/documents/${document.docId}`),
      new URL(`https://x/api/documents/${document.docId}`),
      env,
      "local"
    );
    expect(await get.text()).toBe("hello");
    const bad = await documentsRoute(
      new Request("https://x/api/documents", { method: "POST", headers: { "x-filename": "a%2Fb" }, body: "x" }),
      new URL("https://x/api/documents"),
      env,
      "local"
    );
    expect(bad.status).toBe(400);
  });
});

describe("agent-workspace", () => {
  it("同名の書類をずらす", () => {
    expect(workspaceNames(["a.csv", "a.csv", "A.csv", "b"])).toEqual(["a.csv", "a (2).csv", "A (3).csv", "b"]);
  });

  it("git の -z 出力を読む", () => {
    expect(parseNameStatus("M\0rent.csv\0A\0new.md\0D\0old.txt\0")).toEqual([
      { path: "rent.csv", status: "modified" },
      { path: "new.md", status: "added" },
      { path: "old.txt", status: "deleted" }
    ]);
    expect([...parseBinaryPaths("1\t1\trent.csv\0-\t-\tbook.xlsx\0")]).toEqual(["book.xlsx"]);
    expect(parseModes("100755 abc123 0\trun.sh\u0000100644 def456 0\ta b.md\u0000").get("a b.md")).toBe("100644");
  });
});

describe("agentHostFor", () => {
  const baseEnv = (bucket: R2Bucket) =>
    ({
      DOCS: bucket,
      ANTHROPIC_API_KEY: REAL_KEY,
      FUDO_CONTAINERS: "1",
      USER_SANDBOX: { idFromName: () => ({}), get: () => ({ fetch: vi.fn() }) }
    }) as unknown as Env;

  it("キー・Container・書類の置き場のどれかが無ければ作らない", () => {
    const bucket = memoryBucket();
    expect(agentHostFor({ ...baseEnv(bucket), ANTHROPIC_API_KEY: "" } as Env, "u1")).toBeUndefined();
    expect(agentHostFor({ ...baseEnv(bucket), FUDO_CONTAINERS: "" } as Env, "u1")).toBeUndefined();
    expect(agentHostFor({ ...baseEnv(bucket), DOCS: undefined } as Env, "u1")).toBeUndefined();
    expect(agentHostFor(baseEnv(bucket), "u1")).toBeDefined();
  });

  it("許可リスト外のリポジトリは実行先に渡さない", async () => {
    const host = agentHostFor(baseEnv(memoryBucket()), "u1")!;
    const result = await host.run({ agent: "claude-code", prompt: "直して", workspace: { kind: "repo", repo: "o/r" }, timeoutMs: 5_000 });
    expect(result).toMatchObject({ ok: false, reason: "repo_denied" });
    expect((await host.workspaces()).repos).toEqual([]);
  });

  it("承認で新しい版を保存し、元の版を残し、複製を消す。却下は複製だけ消す", async () => {
    const bucket = memoryBucket();
    const created = await createDocument(bucket, "u1", { name: "rent.csv", media: "text/csv", bytes: new TextEncoder().encode("a,1\n").buffer });
    if (!created.ok) throw new Error("create");
    const host = agentHostFor(baseEnv(bucket), "u1")!;

    const stage = async (runId: string) => {
      const manifest: RunManifest = {
        runId,
        userId: "u1",
        request: { agent: "claude-code", prompt: "直して", workspace: { kind: "files", docIds: [created.ref.docId] }, timeoutMs: 5_000 },
        changes: [
          { path: "rent.csv", status: "modified", mode: "100644" },
          { path: "summary.md", status: "added", mode: "100644" }
        ],
        source: { kind: "files", files: { "rent.csv": { docId: created.ref.docId, version: 1 } } }
      };
      await bucket.put(`${runPrefix("u1", runId)}manifest.json`, JSON.stringify(manifest));
      await bucket.put(`${runPrefix("u1", runId)}files/rent.csv`, "a,2\n");
      await bucket.put(`${runPrefix("u1", runId)}files/summary.md`, "# 要約\n");
    };
    const pending = (runId: string) => ({
      runId,
      agent: "claude-code",
      workspace: { kind: "files" as const, docIds: [created.ref.docId] },
      changes: [],
      result: "",
      label: ""
    });

    await stage("r-reject");
    await host.discard("r-reject");
    expect(bucket.keys().filter((key) => key.startsWith("runs/"))).toEqual([]);
    expect((await listVersions(bucket, "u1", created.ref.docId)).map((doc) => doc.version)).toEqual([1]);

    await stage("r-ok");
    const written = await host.writeBack(pending("r-ok"));
    expect(written).toMatchObject({ ok: true });
    expect((written as { summary: string }).summary).toMatch(/rent\.csv v2、summary\.md（新規）/);
    const v1 = await readDocument(bucket, "u1", created.ref.docId, 1);
    const v2 = await readDocument(bucket, "u1", created.ref.docId, 2);
    expect(new TextDecoder().decode(v1!.bytes)).toBe("a,1\n");
    expect(new TextDecoder().decode(v2!.bytes)).toBe("a,2\n");
    expect((await listDocuments(bucket, "u1")).map((doc) => doc.name).sort()).toEqual(["rent.csv", "summary.md"]);
    expect(bucket.keys().filter((key) => key.startsWith("runs/"))).toEqual([]);

    expect(await host.writeBack(pending("r-ok"))).toMatchObject({ ok: false, reason: "staging_expired" });
  });
});
