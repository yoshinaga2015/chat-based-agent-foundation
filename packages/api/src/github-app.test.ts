import { describe, expect, it } from "vitest";
import { appJwt, githubAppConfig, installationToken, openPullRequest, pkcs1ToPkcs8, resolveBranch } from "./github-app";

async function rsaPem(): Promise<{ pkcs8Pem: string; pkcs1Pem: string; publicKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  )) as { privateKey: CryptoKey; publicKey: CryptoKey };
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
  // PKCS#8 の中の PKCS#1 は、先頭 26 バイト（SEQUENCE・version・algorithm・OCTET STRING 見出し）の後ろ。
  const pkcs1 = pkcs8.slice(26);
  expect(Buffer.from(pkcs1ToPkcs8(pkcs1)).equals(Buffer.from(pkcs8))).toBe(true);
  return {
    pkcs8Pem: `-----BEGIN PRIVATE KEY-----\n${b64(pkcs8)}\n-----END PRIVATE KEY-----`,
    pkcs1Pem: `-----BEGIN RSA PRIVATE KEY-----\n${b64(pkcs1)}\n-----END RSA PRIVATE KEY-----`,
    publicKey: pair.publicKey
  };
}

async function verifies(jwt: string, publicKey: CryptoKey): Promise<boolean> {
  const [header, payload, signature] = jwt.split(".");
  const sig = Buffer.from(signature!.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, sig, new TextEncoder().encode(`${header}.${payload}`));
}

describe("github-app", () => {
  it("空のリポジトリは PR の土台が無いと理由を返す", async () => {
    const fetcher = (async (url: string) =>
      url.endsWith("/repos/o/r")
        ? Response.json({ default_branch: "main" })
        : Response.json({ message: "Git Repository is empty." }, { status: 409 })) as typeof fetch;
    const head = await resolveBranch("t", "o/r", undefined, fetcher);
    expect(head).toMatchObject({ ok: false, reason: "repo_empty" });
  });

  it("設定が揃わなければ null。許可リストは owner/name だけ", () => {
    expect(githubAppConfig({ GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: "k", GITHUB_APP_INSTALLATION_ID: "2" })).toBeNull();
    expect(
      githubAppConfig({ GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: "k", GITHUB_APP_INSTALLATION_ID: "2", FUDO_AGENT_REPOS: "a/b, bad ,c/d" })?.repos
    ).toEqual(["a/b", "c/d"]);
  });

  it("PKCS#1 と PKCS#8 のどちらの鍵でも App JWT を署名できる", async () => {
    const keys = await rsaPem();
    for (const pem of [keys.pkcs1Pem, keys.pkcs8Pem]) {
      const jwt = await appJwt({ appId: "123", privateKey: pem }, 1_000_000);
      expect(await verifies(jwt, keys.publicKey)).toBe(true);
      const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString()) as { iss: string; exp: number };
      expect(payload).toMatchObject({ iss: "123", exp: 1_000_540 });
    }
  });

  it("インストールトークンは許可リストのリポジトリ1つに絞る", async () => {
    const keys = await rsaPem();
    const config = { appId: "1", privateKey: keys.pkcs8Pem, installationId: "9", repos: ["o/allowed"] };
    const calls: { url: string; body: unknown }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return Response.json({ token: "ghs_x" });
    }) as typeof fetch;
    expect(await installationToken(config, "o/other", fetcher)).toMatchObject({ ok: false, reason: "repo_denied" });
    expect(calls).toHaveLength(0);
    expect(await installationToken(config, "o/allowed", fetcher)).toEqual({ ok: true, token: "ghs_x" });
    expect(calls[0]).toEqual({
      url: "https://api.github.com/app/installations/9/access_tokens",
      body: { repositories: ["allowed"], permissions: { contents: "write", pull_requests: "write" } }
    });
  });

  it("PR は起点コミットから作業ブランチを切る。既定ブランチの ref は書き換えない", async () => {
    const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      const path = url.replace("https://api.github.com/repos/o/r", "");
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ method: init?.method ?? "GET", path, ...(body ? { body } : {}) });
      if (path === "/git/commits/base-sha") return Response.json({ tree: { sha: "base-tree" } });
      if (path === "/git/blobs") return Response.json({ sha: `blob-${calls.length}` });
      if (path === "/git/trees") return Response.json({ sha: "new-tree" });
      if (path === "/git/commits") return Response.json({ sha: "new-commit" });
      if (path === "/git/refs") return Response.json({});
      if (path === "/pulls") return Response.json({ html_url: "https://github.com/o/r/pull/7" });
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;
    const pr = await openPullRequest(
      "ghs_x",
      {
        repo: "o/r",
        base: "main",
        baseSha: "base-sha",
        branch: "fudo/agent-abcd1234",
        title: "README を直す",
        body: "",
        files: [
          { path: "README.md", mode: "100644", content: new TextEncoder().encode("# x").buffer },
          { path: "old.txt", mode: "100644", content: null }
        ]
      },
      fetcher
    );
    expect(pr).toEqual({ ok: true, url: "https://github.com/o/r/pull/7" });
    const commit = calls.find((call) => call.path === "/git/commits" && call.method === "POST");
    expect(commit?.body).toMatchObject({ parents: ["base-sha"], tree: "new-tree" });
    const tree = calls.find((call) => call.path === "/git/trees");
    expect(tree?.body).toMatchObject({ base_tree: "base-tree", tree: [{ path: "README.md" }, { path: "old.txt", sha: null }] });
    const refs = calls.filter((call) => call.path.startsWith("/git/refs"));
    expect(refs).toEqual([{ method: "POST", path: "/git/refs", body: { ref: "refs/heads/fudo/agent-abcd1234", sha: "new-commit" } }]);
    expect(calls.find((call) => call.path === "/pulls")?.body).toMatchObject({ head: "fudo/agent-abcd1234", base: "main" });
  });
});
