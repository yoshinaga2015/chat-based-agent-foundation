/**
 * GitHub App。トークンは Worker の中だけで使い、サンドボックスには渡さない。
 * 取り込みは tarball を Worker が取りに行き、書き戻しは REST でブランチと PR を作る。
 */

const API = "https://api.github.com";

export type GithubAppConfig = {
  appId: string;
  privateKey: string;
  installationId: string;
  repos: string[];
};

export type GithubFail = { ok: false; reason: string; detail: { constraint: string } };

type Fetcher = typeof fetch;

export function parseRepoAllow(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(part));
}

export function githubAppConfig(env: {
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
  FUDO_AGENT_REPOS?: string;
}): GithubAppConfig | null {
  const appId = env.GITHUB_APP_ID?.trim();
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.trim();
  const installationId = env.GITHUB_APP_INSTALLATION_ID?.trim();
  const repos = parseRepoAllow(env.FUDO_AGENT_REPOS);
  if (!appId || !privateKey || !installationId || repos.length === 0) return null;
  return { appId, privateKey, installationId, repos };
}

function base64url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function pemBody(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
}

function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const out: number[] = [];
  let rest = length;
  while (rest > 0) {
    out.unshift(rest & 0xff);
    rest >>= 8;
  }
  return [0x80 | out.length, ...out];
}

/** GitHub が配る PKCS#1（BEGIN RSA PRIVATE KEY）を WebCrypto が読める PKCS#8 に包む。 */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const version = [0x02, 0x01, 0x00];
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octet = [0x04, ...derLength(pkcs1.length)];
  const inner = version.length + algorithm.length + octet.length + pkcs1.length;
  const out = new Uint8Array([0x30, ...derLength(inner), ...version, ...algorithm, ...octet, ...pkcs1]);
  return out;
}

async function signingKey(pem: string): Promise<CryptoKey> {
  const der = pem.includes("BEGIN RSA PRIVATE KEY") ? pkcs1ToPkcs8(pemBody(pem)) : pemBody(pem);
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

export async function appJwt(config: Pick<GithubAppConfig, "appId" | "privateKey">, nowSec: number): Promise<string> {
  const encoder = new TextEncoder();
  const header = base64url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64url(encoder.encode(JSON.stringify({ iat: nowSec - 60, exp: nowSec + 540, iss: config.appId })));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    await signingKey(config.privateKey),
    encoder.encode(`${header}.${payload}`)
  );
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

function headers(token: string, scheme: "Bearer" | "token" = "token"): Record<string, string> {
  return {
    authorization: `${scheme} ${token}`,
    accept: "application/vnd.github+json",
    "user-agent": "fudo-agent",
    "x-github-api-version": "2022-11-28"
  };
}

async function failOf(response: Response, step: string): Promise<GithubFail> {
  const text = (await response.text().catch(() => "")).slice(0, 200);
  return { ok: false, reason: "github_error", detail: { constraint: `${step}: HTTP ${response.status} ${text}`.trim() } };
}

/** 対象リポジトリ1つに絞った、書き込みと PR だけのインストールトークン。 */
export async function installationToken(
  config: GithubAppConfig,
  repo: string,
  fetcher: Fetcher = fetch,
  nowSec = Math.floor(Date.now() / 1000)
): Promise<{ ok: true; token: string } | GithubFail> {
  if (!config.repos.includes(repo)) {
    return { ok: false, reason: "repo_denied", detail: { constraint: `${repo} は許可リスト外` } };
  }
  const jwt = await appJwt(config, nowSec);
  const response = await fetcher(`${API}/app/installations/${config.installationId}/access_tokens`, {
    method: "POST",
    headers: { ...headers(jwt, "Bearer"), "content-type": "application/json" },
    body: JSON.stringify({
      repositories: [repo.split("/")[1]],
      permissions: { contents: "write", pull_requests: "write" }
    })
  });
  if (!response.ok) return failOf(response, "installation token");
  const body = (await response.json()) as { token?: unknown };
  if (typeof body.token !== "string") return { ok: false, reason: "github_error", detail: { constraint: "token が無い" } };
  return { ok: true, token: body.token };
}

/** ref（省略で既定ブランチ）を、ブランチ名とコミット SHA に解決する。 */
export async function resolveBranch(
  token: string,
  repo: string,
  ref: string | undefined,
  fetcher: Fetcher = fetch
): Promise<{ ok: true; branch: string; sha: string } | GithubFail> {
  let branch = ref;
  if (!branch) {
    const meta = await fetcher(`${API}/repos/${repo}`, { headers: headers(token) });
    if (!meta.ok) return failOf(meta, "repository");
    branch = ((await meta.json()) as { default_branch?: string }).default_branch;
    if (!branch) return { ok: false, reason: "github_error", detail: { constraint: "既定ブランチが無い" } };
  }
  const head = await fetcher(`${API}/repos/${repo}/git/ref/heads/${branch}`, { headers: headers(token) });
  if (head.status === 409) {
    return { ok: false, reason: "repo_empty", detail: { constraint: `${repo} にコミットが無いので PR の土台がない。先に1つコミットする` } };
  }
  if (!head.ok) return failOf(head, `branch ${branch}`);
  const sha = ((await head.json()) as { object?: { sha?: string } }).object?.sha;
  if (!sha) return { ok: false, reason: "github_error", detail: { constraint: "ブランチの SHA が無い" } };
  return { ok: true, branch, sha };
}

export async function repoTarball(
  token: string,
  repo: string,
  sha: string,
  fetcher: Fetcher = fetch
): Promise<{ ok: true; body: ReadableStream } | GithubFail> {
  const response = await fetcher(`${API}/repos/${repo}/tarball/${sha}`, { headers: headers(token), redirect: "follow" });
  if (!response.ok || !response.body) return failOf(response, "tarball");
  return { ok: true, body: response.body };
}

export type RepoFileChange = { path: string; mode: string; content: ArrayBuffer | null };

/** 実行の起点コミットから作業ブランチを切り、変更を1コミットにして PR を出す。既定ブランチには書かない。 */
export async function openPullRequest(
  token: string,
  input: {
    repo: string;
    base: string;
    baseSha: string;
    branch: string;
    title: string;
    body: string;
    files: RepoFileChange[];
  },
  fetcher: Fetcher = fetch
): Promise<{ ok: true; url: string } | GithubFail> {
  const call = async (path: string, payload: unknown, method = "POST") =>
    fetcher(`${API}/repos/${input.repo}${path}`, {
      method,
      headers: { ...headers(token), "content-type": "application/json" },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
    });

  const baseCommit = await call(`/git/commits/${input.baseSha}`, undefined, "GET");
  if (!baseCommit.ok) return failOf(baseCommit, "base commit");
  const baseTree = ((await baseCommit.json()) as { tree?: { sha?: string } }).tree?.sha;
  if (!baseTree) return { ok: false, reason: "github_error", detail: { constraint: "base tree が無い" } };

  const tree: { path: string; mode: string; type: "blob"; sha: string | null }[] = [];
  for (const file of input.files) {
    if (file.content === null) {
      tree.push({ path: file.path, mode: file.mode, type: "blob", sha: null });
      continue;
    }
    const blob = await call("/git/blobs", { content: bytesToBase64(new Uint8Array(file.content)), encoding: "base64" });
    if (!blob.ok) return failOf(blob, `blob ${file.path}`);
    const sha = ((await blob.json()) as { sha?: string }).sha;
    if (!sha) return { ok: false, reason: "github_error", detail: { constraint: `blob ${file.path} の SHA が無い` } };
    tree.push({ path: file.path, mode: file.mode, type: "blob", sha });
  }

  const treeRes = await call("/git/trees", { base_tree: baseTree, tree });
  if (!treeRes.ok) return failOf(treeRes, "tree");
  const treeSha = ((await treeRes.json()) as { sha?: string }).sha;

  const commitRes = await call("/git/commits", { message: input.title, tree: treeSha, parents: [input.baseSha] });
  if (!commitRes.ok) return failOf(commitRes, "commit");
  const commitSha = ((await commitRes.json()) as { sha?: string }).sha;

  const refRes = await call("/git/refs", { ref: `refs/heads/${input.branch}`, sha: commitSha });
  if (!refRes.ok) return failOf(refRes, "branch");

  const pr = await call("/pulls", { title: input.title, head: input.branch, base: input.base, body: input.body });
  if (!pr.ok) return failOf(pr, "pull request");
  const url = ((await pr.json()) as { html_url?: string }).html_url;
  if (!url) return { ok: false, reason: "github_error", detail: { constraint: "PR の URL が無い" } };
  return { ok: true, url };
}
