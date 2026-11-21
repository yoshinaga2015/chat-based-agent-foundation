// Remote MCP 設定の正本とバリデーション。UI・API・mcp_configure が共有する。
import {
  catalogById,
  catalogHosts,
  isHostAllowed,
  mergeMcpHosts,
  type McpAuthKind
} from "./mcp-catalog";
import {
  accessTokenFromSecret,
  oauthSecretNeedsRefresh,
  parseOAuthSecret,
  packOAuthSecret,
  refreshMcpOAuthSecret
} from "./mcp-oauth";
import { isSealedMcpSecret, openMcpSecret, sealMcpSecret } from "./mcp-secret-crypto";

export type { McpAuthKind } from "./mcp-catalog";

export interface McpServer {
  id: string;
  name: string;
  url: string;
  auth: McpAuthKind;
  /** bearer / oauth の秘密（保管時は可能なら AES-GCM）。画面・ログに出さない。 */
  secret?: string;
  catalogId?: string;
  /** Streamable HTTP のセッション（InitializeResult の Mcp-Session-Id）。 */
  sessionId?: string;
  protocolVersion?: string;
  /** 401 / insufficient_scope 後の再接続待ち。 */
  needsReauth?: boolean;
  reauthScope?: string;
  /** 行内の一過性フィードバック（接続テスト）。時間経過で消してよい。 */
  lastProbe?: { ok: boolean; detail: string; at: number; tools?: string[] };
  /** 設定ダイアログ用の tools/list 名。dismiss しても残す。 */
  listedTools?: string[];
}

/** 画面用。secret は出さない。 */
export type McpServerView = {
  id: string;
  name: string;
  url: string;
  auth: McpAuthKind;
  hasSecret: boolean;
  catalogId?: string;
  needsReauth: boolean;
  lastProbe?: { ok: boolean; detail: string; at: number; tools?: string[] };
  listedTools?: string[];
};

export type McpSaveResult =
  | { ok: true; servers: McpServer[]; grantHost?: string }
  | { ok: false; reason: "invalid_value" | "confirm_host"; detail: { constraint: string; host?: string } };

export type PendingMcp =
  | { op: "upsert"; server: McpServer; grantHost?: string }
  | { op: "remove"; id: string };

export type McpSaveInput = {
  id?: string;
  name?: string;
  url?: string;
  auth?: McpAuthKind;
  /** 新規または差し替え。空文字は「変更なし」。 */
  secret?: string;
  catalogId?: string;
  /** カタログ外ホストを能力ペインから明示確認したとき。 */
  confirmUnknownHost?: boolean;
};

export function parseHostAllowList(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

export function resolveMcpHostAllow(
  envAllowRaw: string | undefined,
  userHosts: readonly string[] = []
): string[] {
  return mergeMcpHosts(catalogHosts(), parseHostAllowList(envAllowRaw), userHosts);
}

export function validateMcpUrl(
  urlText: string,
  allowHosts: readonly string[]
): { ok: true; url: URL } | { ok: false; constraint: string; host?: string } {
  let url: URL;
  try {
    url = new URL(urlText.trim());
  } catch {
    return { ok: false, constraint: "URL が不正" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, constraint: "MCP の URL は https のみ" };
  }
  const host = url.hostname.toLowerCase();
  if (allowHosts.length === 0) {
    return { ok: false, constraint: "MCP ホスト許可リストが空" };
  }
  if (!isHostAllowed(host, allowHosts)) {
    return { ok: false, constraint: `ホスト ${host} は許可リスト外`, host };
  }
  return { ok: true, url };
}

export function viewMcpServers(servers: readonly McpServer[]): McpServerView[] {
  return pruneIncompleteMcp(servers).map((server) => ({
    id: server.id,
    name: server.name,
    url: server.url,
    auth: server.auth,
    hasSecret: Boolean(server.secret),
    needsReauth: server.needsReauth === true,
    ...(server.catalogId ? { catalogId: server.catalogId } : {}),
    ...(server.lastProbe ? { lastProbe: server.lastProbe } : {}),
    ...(server.listedTools && server.listedTools.length > 0
      ? { listedTools: server.listedTools }
      : {})
  }));
}

/** 保存前に秘密を封じる。キーが無ければ平文。 */
export async function sealServerSecret(server: McpServer): Promise<McpServer> {
  if (!server.secret) return server;
  const sealed = await sealMcpSecret(server.secret);
  return sealed === server.secret ? server : { ...server, secret: sealed };
}

/** bearer/oauth で秘密が無い行は未接続。再接続待ちは残す。 */
export function pruneIncompleteMcp(servers: readonly McpServer[]): McpServer[] {
  return servers.filter(
    (server) => server.auth === "none" || Boolean(server.secret) || server.needsReauth === true
  );
}

export function isMcpConnected(server: Pick<McpServer, "auth" | "secret" | "needsReauth"> | Pick<McpServerView, "auth" | "hasSecret" | "needsReauth">): boolean {
  if ("needsReauth" in server && server.needsReauth) return false;
  if (server.auth === "none") return true;
  if ("hasSecret" in server) return server.hasSecret;
  return Boolean(server.secret);
}

export function saveMcp(
  servers: readonly McpServer[],
  input: McpSaveInput,
  allowHosts: readonly string[]
): McpSaveResult {
  const fromCatalog = input.catalogId ? catalogById(input.catalogId) : undefined;
  const name = (input.name ?? fromCatalog?.name ?? "").trim();
  const urlText = (input.url ?? fromCatalog?.url ?? "").trim();
  const auth = normalizeAuth(input.auth ?? fromCatalog?.auth[0] ?? "none", fromCatalog?.auth);
  if (!name) return { ok: false, reason: "invalid_value", detail: { constraint: "名称が要る" } };
  if (!urlText) return { ok: false, reason: "invalid_value", detail: { constraint: "URL が要る" } };

  let url: URL;
  try {
    url = new URL(urlText.trim());
  } catch {
    return { ok: false, reason: "invalid_value", detail: { constraint: "URL が不正" } };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "invalid_value", detail: { constraint: "MCP の URL は https のみ" } };
  }
  const host = url.hostname.toLowerCase();
  let grantHost: string | undefined;
  if (!isHostAllowed(host, allowHosts)) {
    if (!input.confirmUnknownHost) {
      return {
        ok: false,
        reason: "confirm_host",
        detail: { constraint: `ホスト ${host} はカタログ外。確認して追加`, host }
      };
    }
    grantHost = host;
  }

  const id = (input.id ?? fromCatalog?.id ?? "").trim() || slugId(name);
  const previous = servers.find((server) => server.id === id);
  const secret = resolveSecret(previous?.secret, input.secret);
  if (auth === "bearer" && !secret) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "Bearer トークンが要る" } };
  }
  if (auth === "oauth" && !secret) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "OAuth 接続が要る" } };
  }

  const next: McpServer = {
    id,
    name,
    url: url.toString(),
    auth,
    ...(secret ? { secret } : {}),
    ...(fromCatalog || input.catalogId ? { catalogId: fromCatalog?.id ?? input.catalogId } : {}),
    needsReauth: false,
    reauthScope: undefined
  };
  const others = servers.filter((server) => server.id !== id);
  if (others.some((server) => server.name === name)) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "同じ名称の MCP がある" } };
  }
  return { ok: true, servers: [...others, next], ...(grantHost ? { grantHost } : {}) };
}

export function removeMcp(servers: readonly McpServer[], id: string): McpSaveResult {
  const trimmed = id.trim();
  if (!trimmed) return { ok: false, reason: "invalid_value", detail: { constraint: "id が要る" } };
  if (!servers.some((server) => server.id === trimmed)) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "見つからない" } };
  }
  return { ok: true, servers: servers.filter((server) => server.id !== trimmed) };
}

export function labelPendingMcp(pending: PendingMcp): string {
  if (pending.op === "upsert") {
    const hostNote = pending.grantHost ? `（ホスト ${pending.grantHost} を許可）` : "";
    return `MCP「${pending.server.name}」（${pending.server.url}）を登録する${hostNote}`;
  }
  return `MCP ${pending.id} を削除する`;
}

export function applyPendingMcp(servers: readonly McpServer[], pending: PendingMcp): McpSaveResult {
  if (pending.op === "remove") return removeMcp(servers, pending.id);
  const others = servers.filter((server) => server.id !== pending.server.id);
  return {
    ok: true,
    servers: [...others, pending.server],
    ...(pending.grantHost ? { grantHost: pending.grantHost } : {})
  };
}

function normalizeAuth(auth: McpAuthKind, allowed?: readonly McpAuthKind[]): McpAuthKind {
  if (auth !== "none" && auth !== "bearer" && auth !== "oauth") return "none";
  if (allowed && allowed.length > 0 && !allowed.includes(auth)) return allowed[0]!;
  return auth;
}

function resolveSecret(previous: string | undefined, next: string | undefined): string | undefined {
  if (next === undefined) return previous;
  const trimmed = next.trim();
  if (!trimmed) return previous;
  return trimmed;
}

function slugId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return base || `mcp-${Date.now()}`;
}

/** Remote MCP Streamable HTTP。試験では差し替え可。server は refresh／session 更新時に返す。 */
export type McpTransport = {
  listTools: (
    server: McpServer
  ) => Promise<{ ok: true; tools: unknown[]; server: McpServer } | { ok: false; reason: string; server?: McpServer }>;
  callTool: (
    server: McpServer,
    name: string,
    args: unknown
  ) => Promise<{ ok: true; result: unknown; server: McpServer } | { ok: false; reason: string; server?: McpServer }>;
};

const PROTOCOL_VERSION = "2025-03-26";

export function toolNamesFromList(tools: unknown[]): string[] {
  return tools.flatMap((tool) => {
    if (!tool || typeof tool !== "object" || !("name" in tool) || typeof tool.name !== "string") return [];
    const name = tool.name.trim();
    return name ? [name] : [];
  });
}

export function authHeaders(server: McpServer): Record<string, string> {
  const token = accessTokenFromSecret(server.auth, server.secret);
  if (token) return { authorization: `Bearer ${token}` };
  return {};
}

export function httpMcpTransport(fetchImpl: typeof fetch = fetch): McpTransport {
  return {
    async listTools(server) {
      const ready = await withSession(server, fetchImpl);
      if (!ready.ok) return failPersist(ready, fetchImpl);
      const listed = await mcpRpc(fetchImpl, ready.server, "tools/list", {});
      if (!listed.ok) {
        if (listed.reason === "http_404" && ready.server.sessionId) {
          const cleared = { ...ready.server, sessionId: undefined, protocolVersion: undefined };
          const retry = await withSession(cleared, fetchImpl);
          if (!retry.ok) return failPersist(retry, fetchImpl);
          const again = await mcpRpc(fetchImpl, retry.server, "tools/list", {});
          if (!again.ok) return failAuth(retry.server, again, fetchImpl);
          return toolsOk(await persistSecret(retry.server), again.result);
        }
        return failAuth(ready.server, listed, fetchImpl);
      }
      return toolsOk(await persistSecret(ready.server), listed.result);
    },
    async callTool(server, name, args) {
      const ready = await withSession(server, fetchImpl);
      if (!ready.ok) return failPersist(ready, fetchImpl);
      const payload = {
        name,
        arguments: args && typeof args === "object" ? args : {}
      };
      const called = await mcpRpc(fetchImpl, ready.server, "tools/call", payload);
      if (!called.ok) {
        const marked = await markReauthIfNeeded(ready.server, called.reason, called.wwwAuthenticate, fetchImpl);
        if (marked.reason === "token_refreshed") {
          const opened = await prepareServerAuth(marked.server, fetchImpl);
          if (!opened.ok) return { ok: false, reason: opened.reason, server: await persistSecret(marked.server) };
          const again = await mcpRpc(fetchImpl, opened.server, "tools/call", payload);
          if (!again.ok) return failAuth(opened.server, again, fetchImpl);
          return { ok: true, result: again.result, server: await persistSecret(opened.server) };
        }
        return { ok: false, reason: marked.reason, server: await persistSecret(marked.server) };
      }
      return { ok: true, result: called.result, server: await persistSecret(ready.server) };
    }
  };
}

async function failAuth(
  server: McpServer,
  failed: { reason: string; wwwAuthenticate?: string },
  fetchImpl: typeof fetch
): Promise<{ ok: false; reason: string; server: McpServer }> {
  const marked = await markReauthIfNeeded(server, failed.reason, failed.wwwAuthenticate, fetchImpl);
  if (marked.reason === "token_refreshed") {
    return { ok: false, reason: "token_refreshed", server: await persistSecret(marked.server) };
  }
  return { ok: false, reason: marked.reason, server: await persistSecret(marked.server) };
}

async function failPersist(
  failed: { ok: false; reason: string; server?: McpServer; wwwAuthenticate?: string },
  fetchImpl?: typeof fetch
): Promise<{ ok: false; reason: string; server?: McpServer }> {
  if (!failed.server) return failed;
  if (fetchImpl && (failed.reason === "http_401" || failed.reason === "insufficient_scope")) {
    const marked = await markReauthIfNeeded(failed.server, failed.reason, failed.wwwAuthenticate, fetchImpl);
    return { ok: false, reason: marked.reason, server: await persistSecret(marked.server) };
  }
  return { ok: false, reason: failed.reason, server: await persistSecret(failed.server) };
}

/** desk に戻す前に平文秘密を封じる。 */
async function persistSecret(server: McpServer): Promise<McpServer> {
  if (!server.secret || isSealedMcpSecret(server.secret)) return server;
  return { ...server, secret: await sealMcpSecret(server.secret) };
}

async function markReauthIfNeeded(
  server: McpServer,
  reason: string,
  wwwAuthenticate: string | undefined,
  fetchImpl: typeof fetch
): Promise<{ reason: string; server: McpServer }> {
  if (reason !== "http_401" && reason !== "insufficient_scope") {
    return { reason, server };
  }
  const scope = scopeFromWwwAuthenticate(wwwAuthenticate) || server.reauthScope;
  if (reason === "http_401" && server.auth === "oauth" && server.secret) {
    try {
      const opened = await openMcpSecret(server.secret);
      const packed = parseOAuthSecret(opened);
      if (packed?.refresh_token) {
        const refreshed = await refreshMcpOAuthSecret(packed, Date.now(), fetchImpl);
        if (refreshed.ok) {
          const sealed = await sealMcpSecret(packOAuthSecret(refreshed.secret));
          return {
            reason: "token_refreshed",
            server: { ...server, secret: sealed, needsReauth: false, reauthScope: undefined }
          };
        }
      }
    } catch {
      // fall through to reauth
    }
  }
  const nextReason = reason === "insufficient_scope" ? "insufficient_scope" : "oauth_reauth";
  return {
    reason: nextReason,
    server: {
      ...server,
      secret: reason === "insufficient_scope" ? server.secret : undefined,
      sessionId: undefined,
      protocolVersion: undefined,
      needsReauth: true,
      ...(scope ? { reauthScope: scope } : { reauthScope: undefined })
    }
  };
}

function scopeFromWwwAuthenticate(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /scope="([^"]+)"/i.exec(header);
  return match?.[1]?.trim() || undefined;
}

function toolsOk(
  server: McpServer,
  result: unknown
): { ok: true; tools: unknown[]; server: McpServer } {
  const tools = result && typeof result === "object" && "tools" in result && Array.isArray(result.tools)
    ? result.tools
    : [];
  return { ok: true, tools, server };
}

async function withSession(
  server: McpServer,
  fetchImpl: typeof fetch
): Promise<
  | { ok: true; server: McpServer }
  | { ok: false; reason: string; server?: McpServer; wwwAuthenticate?: string }
> {
  const prepared = await prepareServerAuth(server, fetchImpl);
  if (!prepared.ok) return prepared;
  if (prepared.server.sessionId) return prepared;
  return initializeSession(prepared.server, fetchImpl);
}

async function prepareServerAuth(
  server: McpServer,
  fetchImpl: typeof fetch
): Promise<{ ok: true; server: McpServer } | { ok: false; reason: string }> {
  if (server.needsReauth && !server.secret) return { ok: false, reason: "oauth_reauth" };
  if (server.auth === "oauth" && !server.secret) return { ok: false, reason: "oauth_required" };
  if (server.auth === "bearer" && !server.secret) return { ok: false, reason: "bearer_required" };
  let working = server;
  if (server.secret) {
    try {
      const opened = await openMcpSecret(server.secret);
      working = opened === server.secret ? server : { ...server, secret: opened };
    } catch {
      return { ok: false, reason: "secret_unlock_failed" };
    }
  }
  if (working.auth !== "oauth" || !working.secret) return { ok: true, server: working };
  const packed = parseOAuthSecret(working.secret);
  if (!packed) return { ok: true, server: working };
  if (!oauthSecretNeedsRefresh(packed)) return { ok: true, server: working };
  const refreshed = await refreshMcpOAuthSecret(packed, Date.now(), fetchImpl);
  if (!refreshed.ok) return { ok: true, server: working };
  const sealed = await sealMcpSecret(packOAuthSecret(refreshed.secret));
  return { ok: true, server: { ...working, secret: sealed, needsReauth: false, reauthScope: undefined } };
}

async function initializeSession(
  server: McpServer,
  fetchImpl: typeof fetch
): Promise<
  | { ok: true; server: McpServer }
  | { ok: false; reason: string; server?: McpServer; wwwAuthenticate?: string }
> {
  const init = await mcpRpc(fetchImpl, { ...server, sessionId: undefined }, "initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "fudo", version: "0" }
  });
  if (!init.ok) return { ...init, server };
  const protocolVersion =
    init.result && typeof init.result === "object" && "protocolVersion" in init.result && typeof init.result.protocolVersion === "string"
      ? init.result.protocolVersion
      : PROTOCOL_VERSION;
  const next: McpServer = {
    ...server,
    protocolVersion,
    ...(init.sessionId ? { sessionId: init.sessionId } : {})
  };
  await mcpNotify(fetchImpl, next, "notifications/initialized", {});
  return { ok: true, server: next };
}

/** 能力ペインの接続試験。tools/list が通れば接続 OK。 */
export async function probeMcp(
  server: McpServer,
  transport: McpTransport = httpMcpTransport()
): Promise<{ ok: true; tools: string[]; server?: McpServer } | { ok: false; reason: string; server?: McpServer }> {
  const listed = await transport.listTools(server);
  if (!listed.ok) return { ok: false, reason: listed.reason, ...(listed.server ? { server: listed.server } : {}) };
  return { ok: true, tools: toolNamesFromList(listed.tools), server: listed.server };
}

async function mcpRpc(
  fetchImpl: typeof fetch,
  server: McpServer,
  method: string,
  params: unknown
): Promise<
  | { ok: true; result: unknown; sessionId?: string }
  | { ok: false; reason: string; wwwAuthenticate?: string }
> {
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...authHeaders(server)
    };
    if (server.sessionId) headers["mcp-session-id"] = server.sessionId;
    if (server.protocolVersion) headers["mcp-protocol-version"] = server.protocolVersion;

    const response = await fetchImpl(server.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
    });
    const sessionId = response.headers.get("mcp-session-id") ?? undefined;
    const wwwAuthenticate = response.headers.get("www-authenticate") ?? undefined;
    if (response.status === 401) {
      const insufficient = wwwAuthenticate && /insufficient_scope/i.test(wwwAuthenticate);
      return {
        ok: false,
        reason: insufficient ? "insufficient_scope" : "http_401",
        ...(wwwAuthenticate ? { wwwAuthenticate } : {})
      };
    }
    if (response.status === 403 && wwwAuthenticate && /insufficient_scope/i.test(wwwAuthenticate)) {
      return { ok: false, reason: "insufficient_scope", wwwAuthenticate };
    }
    if (!response.ok) {
      const detail = await mcpHttpErrorDetail(response);
      return {
        ok: false,
        reason: detail ? `${detail}` : `http_${response.status}`,
        ...(wwwAuthenticate ? { wwwAuthenticate } : {})
      };
    }
    const parsed = await readMcpResponse(response);
    if (!parsed.ok) return parsed;
    return { ok: true, result: parsed.result, ...(sessionId ? { sessionId } : {}) };
  } catch {
    return { ok: false, reason: "mcp_unreachable" };
  }
}

/** HTTP エラー本文の JSON-RPC message を拾う（Slack の MCP 未有効など）。 */
async function mcpHttpErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      const text = await response.text();
      const message = parseSseJsonRpc(text);
      const msg = message?.error?.message?.trim();
      return msg || undefined;
    }
    const body = (await response.json()) as { error?: { message?: string } };
    const msg = body.error?.message?.trim();
    return msg || undefined;
  } catch {
    return undefined;
  }
}

async function mcpNotify(
  fetchImpl: typeof fetch,
  server: McpServer,
  method: string,
  params: unknown
): Promise<void> {
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...authHeaders(server)
    };
    if (server.sessionId) headers["mcp-session-id"] = server.sessionId;
    if (server.protocolVersion) headers["mcp-protocol-version"] = server.protocolVersion;
    await fetchImpl(server.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", method, params })
    });
  } catch {
    // 通知失敗は無視（多くのサーバは任意）
  }
}

async function readMcpResponse(
  response: Response
): Promise<{ ok: true; result: unknown } | { ok: false; reason: string }> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const text = await response.text();
    const message = parseSseJsonRpc(text);
    if (!message) return { ok: false, reason: "sse_empty" };
    if (message.error) return { ok: false, reason: message.error.message ?? "mcp_error" };
    return { ok: true, result: message.result ?? null };
  }
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) return { ok: false, reason: body.error.message ?? "mcp_error" };
  return { ok: true, result: body.result ?? null };
}

/** SSE 本文から最後の JSON-RPC 応答を拾う。 */
export function parseSseJsonRpc(text: string): { result?: unknown; error?: { message?: string } } | null {
  let last: { result?: unknown; error?: { message?: string } } | null = null;
  for (const block of text.split(/\n\n+/)) {
    const dataLines = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) continue;
    const payload = dataLines.join("\n").trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const parsed = JSON.parse(payload) as { result?: unknown; error?: { message?: string }; method?: string };
      if (parsed && typeof parsed === "object" && ("result" in parsed || "error" in parsed) && !("method" in parsed && parsed.method)) {
        last = parsed;
      } else if (parsed && typeof parsed === "object" && "result" in parsed) {
        last = parsed;
      }
    } catch {
      // skip bad event
    }
  }
  return last;
}
