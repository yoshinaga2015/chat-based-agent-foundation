/** Remote MCP の OAuth 2.1（PKCE・発見・事前登録／CIMD／DCR・トークン交換）。 */
import { mcpClientIdMetadataUrl, preRegisteredOAuthClient } from "./mcp-client-meta";

export type McpOAuthMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
  /** AS が Client ID Metadata Documents を受け付けるとき。 */
  client_id_metadata_document_supported?: boolean;
};

export type PendingMcpOAuth = {
  state: string;
  codeVerifier: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpoint: string;
  redirectUri: string;
  resource: string;
  mcpUrl: string;
  name: string;
  catalogId?: string;
  publicOrigin: string;
  scope: string;
  expiresAt: number;
};

/** server.secret に JSON で載せる OAuth 秘密。画面・ログに出さない。 */
export type McpOAuthSecret = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  client_id: string;
  client_secret?: string;
  token_endpoint: string;
  resource: string;
};

const PENDING_TTL_MS = 10 * 60 * 1000;

export function packOAuthSecret(secret: McpOAuthSecret): string {
  return JSON.stringify(secret);
}

export function parseOAuthSecret(raw: string | undefined): McpOAuthSecret | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as Partial<McpOAuthSecret>;
    if (typeof parsed.access_token !== "string" || !parsed.access_token) return null;
    if (typeof parsed.client_id !== "string" || !parsed.client_id) return null;
    if (typeof parsed.token_endpoint !== "string" || !parsed.token_endpoint) return null;
    if (typeof parsed.resource !== "string" || !parsed.resource) return null;
    return {
      access_token: parsed.access_token,
      client_id: parsed.client_id,
      token_endpoint: parsed.token_endpoint,
      resource: parsed.resource,
      ...(typeof parsed.refresh_token === "string" ? { refresh_token: parsed.refresh_token } : {}),
      ...(typeof parsed.expires_at === "number" ? { expires_at: parsed.expires_at } : {}),
      ...(typeof parsed.client_secret === "string" ? { client_secret: parsed.client_secret } : {})
    };
  } catch {
    return null;
  }
}

export function accessTokenFromSecret(auth: "none" | "bearer" | "oauth", secret: string | undefined): string | undefined {
  if (!secret) return undefined;
  if (auth === "oauth") {
    const packed = parseOAuthSecret(secret);
    return packed?.access_token ?? undefined;
  }
  if (auth === "bearer") return secret;
  return undefined;
}

export async function discoverMcpOAuth(
  mcpUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; metadata: McpOAuthMetadata; resource: string; scope: string } | { ok: false; reason: string }> {
  const prm = await fetchProtectedResourceMetadata(mcpUrl, fetchImpl);
  if (!prm.ok) return prm;
  const authServer = prm.authorizationServers[0];
  if (!authServer) return { ok: false, reason: "authorization_server_missing" };
  const metadata = await fetchAuthorizationServerMetadata(authServer, fetchImpl);
  if (!metadata.ok) return metadata;
  return {
    ok: true,
    metadata: metadata.metadata,
    resource: prm.resource,
    scope: prm.scope
  };
}

export async function beginMcpOAuthFlow(input: {
  mcpUrl: string;
  name: string;
  catalogId?: string;
  redirectUri: string;
  publicOrigin: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  /** insufficient_scope 再認可時の追加 scope。 */
  extraScope?: string;
  now?: number;
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
}): Promise<{ ok: true; authorizeUrl: string; pending: PendingMcpOAuth } | { ok: false; reason: string }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const discovered = await discoverMcpOAuth(input.mcpUrl, fetchImpl);
  if (!discovered.ok) return discovered;

  const pkce = assertPkceSupport(discovered.metadata);
  if (!pkce.ok) return pkce;

  const registered = await resolveOAuthClient({
    metadata: discovered.metadata,
    redirectUri: input.redirectUri,
    publicOrigin: input.publicOrigin,
    catalogId: input.catalogId,
    oauthClientId: input.oauthClientId,
    oauthClientSecret: input.oauthClientSecret,
    fetchImpl,
    env: input.env
  });
  if (!registered.ok) return registered;

  const codeVerifier = randomUrlSafe(32);
  const codeChallenge = await sha256Challenge(codeVerifier);
  const state = randomUrlSafe(24);
  const now = input.now ?? Date.now();
  const scope = mergeScopes(discovered.scope, input.extraScope);
  const pending: PendingMcpOAuth = {
    state,
    codeVerifier,
    clientId: registered.clientId,
    ...(registered.clientSecret ? { clientSecret: registered.clientSecret } : {}),
    tokenEndpoint: discovered.metadata.token_endpoint,
    redirectUri: input.redirectUri,
    resource: discovered.resource,
    mcpUrl: input.mcpUrl,
    name: input.name,
    ...(input.catalogId ? { catalogId: input.catalogId } : {}),
    publicOrigin: input.publicOrigin,
    scope,
    expiresAt: now + PENDING_TTL_MS
  };

  const params = new URLSearchParams({
    response_type: "code",
    client_id: pending.clientId,
    redirect_uri: pending.redirectUri,
    state: pending.state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    resource: pending.resource
  });
  if (pending.scope) params.set("scope", pending.scope);

  return {
    ok: true,
    authorizeUrl: `${discovered.metadata.authorization_endpoint}?${params.toString()}`,
    pending
  };
}

/** 事前登録 → CIMD → DCR。仕様の推奨順。 */
export async function resolveOAuthClient(input: {
  metadata: McpOAuthMetadata;
  redirectUri: string;
  publicOrigin: string;
  catalogId?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
}): Promise<{ ok: true; clientId: string; clientSecret?: string } | { ok: false; reason: string }> {
  if (input.oauthClientId?.trim()) {
    return {
      ok: true,
      clientId: input.oauthClientId.trim(),
      ...(input.oauthClientSecret?.trim() ? { clientSecret: input.oauthClientSecret.trim() } : {})
    };
  }
  const pre = preRegisteredOAuthClient(input.catalogId, input.env);
  if (pre) return { ok: true, clientId: pre.clientId, ...(pre.clientSecret ? { clientSecret: pre.clientSecret } : {}) };

  // CIMD の client_id は AS が URL を fetch する。localhost 等は届かないのでスキップして DCR へ。
  const cimdUrl = mcpClientIdMetadataUrl(input.publicOrigin);
  if (
    input.metadata.client_id_metadata_document_supported === true &&
    isPubliclyFetchableOrigin(input.publicOrigin)
  ) {
    return { ok: true, clientId: cimdUrl };
  }

  if (input.metadata.registration_endpoint) {
    return registerOAuthClient(input.metadata, input.redirectUri, input.fetchImpl ?? fetch);
  }

  return { ok: false, reason: "registration_unsupported" };
}

/** AS が CIMD を取りに来れる公開オリジンか（http(s) の loopback／私有は不可）。 */
export function isPubliclyFetchableOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
      return false;
    }
    if (host.endsWith(".local") || host.endsWith(".internal")) return false;
    // 本番は https 必須。http の非 loopback は開発トンネル想定で許容しない（AS が http を拒むことが多い）。
    if (url.protocol === "http:") return false;
    return true;
  } catch {
    return false;
  }
}

function assertPkceSupport(
  metadata: McpOAuthMetadata
): { ok: true } | { ok: false; reason: string } {
  const methods = metadata.code_challenge_methods_supported;
  if (!methods) {
    // OIDC メタに欠ける AS（GitHub 等）がある。S256 で進め、無いと明言されたときだけ拒む。
    return { ok: true };
  }
  if (!methods.includes("S256")) return { ok: false, reason: "pkce_s256_unsupported" };
  return { ok: true };
}

function mergeScopes(...parts: Array<string | undefined>): string {
  const set = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    for (const scope of part.split(/\s+/)) {
      const trimmed = scope.trim();
      if (trimmed) set.add(trimmed);
    }
  }
  return [...set].join(" ");
}

export async function finishMcpOAuthFlow(input: {
  pending: PendingMcpOAuth;
  code: string;
  state: string;
  now?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; secret: string } | { ok: false; reason: string }> {
  if (input.state !== input.pending.state) return { ok: false, reason: "state_mismatch" };
  const now = input.now ?? Date.now();
  if (now > input.pending.expiresAt) return { ok: false, reason: "oauth_expired" };

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.pending.redirectUri,
    client_id: input.pending.clientId,
    code_verifier: input.pending.codeVerifier,
    resource: input.pending.resource
  });
  if (input.pending.clientSecret) body.set("client_secret", input.pending.clientSecret);

  const tokens = await postToken(input.pending.tokenEndpoint, body, input.fetchImpl ?? fetch);
  if (!tokens.ok) return tokens;

  const secret: McpOAuthSecret = {
    access_token: tokens.access_token,
    client_id: input.pending.clientId,
    token_endpoint: input.pending.tokenEndpoint,
    resource: input.pending.resource,
    ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
    ...(tokens.expires_in ? { expires_at: now + tokens.expires_in * 1000 } : {}),
    ...(input.pending.clientSecret ? { client_secret: input.pending.clientSecret } : {})
  };
  return { ok: true, secret: packOAuthSecret(secret) };
}

export async function refreshMcpOAuthSecret(
  secret: McpOAuthSecret,
  now = Date.now(),
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; secret: McpOAuthSecret } | { ok: false; reason: string }> {
  if (!secret.refresh_token) return { ok: false, reason: "refresh_missing" };
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: secret.refresh_token,
    client_id: secret.client_id,
    resource: secret.resource
  });
  if (secret.client_secret) body.set("client_secret", secret.client_secret);
  const tokens = await postToken(secret.token_endpoint, body, fetchImpl);
  if (!tokens.ok) return tokens;
  return {
    ok: true,
    secret: {
      ...secret,
      access_token: tokens.access_token,
      ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
      ...(tokens.expires_in ? { expires_at: now + tokens.expires_in * 1000 } : { expires_at: undefined })
    }
  };
}

export function oauthSecretNeedsRefresh(secret: McpOAuthSecret, now = Date.now()): boolean {
  if (!secret.expires_at) return false;
  return secret.expires_at - now < 60_000;
}

async function fetchProtectedResourceMetadata(
  mcpUrl: string,
  fetchImpl: typeof fetch
): Promise<
  | { ok: true; resource: string; authorizationServers: string[]; scope: string }
  | { ok: false; reason: string }
> {
  const fromProbe = await probeResourceMetadata(mcpUrl, fetchImpl);
  if (fromProbe) {
    const loaded = await loadProtectedResource(fromProbe, fetchImpl);
    if (loaded.ok) return loaded;
  }

  const url = new URL(mcpUrl);
  const candidates = [
    `${url.origin}/.well-known/oauth-protected-resource${url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "")}`,
    `${url.origin}/.well-known/oauth-protected-resource`,
    new URL("/.well-known/oauth-protected-resource", mcpUrl).toString()
  ];
  for (const candidate of candidates) {
    const loaded = await loadProtectedResource(candidate, fetchImpl);
    if (loaded.ok) return loaded;
  }
  return { ok: false, reason: "protected_resource_metadata_missing" };
}

async function probeResourceMetadata(mcpUrl: string, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const response = await fetchImpl(mcpUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "fudo", version: "0" }
        }
      })
    });
    const header = response.headers.get("www-authenticate") ?? "";
    const match = /resource_metadata="([^"]+)"/i.exec(header);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function loadProtectedResource(
  metadataUrl: string,
  fetchImpl: typeof fetch
): Promise<
  | { ok: true; resource: string; authorizationServers: string[]; scope: string }
  | { ok: false; reason: string }
> {
  try {
    const response = await fetchImpl(metadataUrl, { headers: { accept: "application/json" } });
    if (!response.ok) return { ok: false, reason: `prm_http_${response.status}` };
    const body = (await response.json()) as {
      resource?: string;
      authorization_servers?: unknown;
      scopes_supported?: unknown;
    };
    const servers = Array.isArray(body.authorization_servers)
      ? body.authorization_servers.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
    if (servers.length === 0) return { ok: false, reason: "authorization_server_missing" };
    const scopes = Array.isArray(body.scopes_supported)
      ? body.scopes_supported.filter((item): item is string => typeof item === "string")
      : [];
    return {
      ok: true,
      resource: typeof body.resource === "string" && body.resource ? body.resource : new URL(metadataUrl).origin,
      authorizationServers: servers,
      scope: scopes[0] ?? ""
    };
  } catch {
    return { ok: false, reason: "prm_unreachable" };
  }
}

async function fetchAuthorizationServerMetadata(
  authServerUrl: string,
  fetchImpl: typeof fetch
): Promise<{ ok: true; metadata: McpOAuthMetadata } | { ok: false; reason: string }> {
  const base = authServerUrl.endsWith("/") ? authServerUrl.slice(0, -1) : authServerUrl;
  for (const candidate of authorizationServerMetadataUrls(authServerUrl)) {
    try {
      const response = await fetchImpl(candidate, { headers: { accept: "application/json" } });
      if (!response.ok) continue;
      const body = (await response.json()) as Partial<McpOAuthMetadata>;
      if (!body.authorization_endpoint || !body.token_endpoint) continue;
      return {
        ok: true,
        metadata: {
          issuer: typeof body.issuer === "string" ? body.issuer : base,
          authorization_endpoint: body.authorization_endpoint,
          token_endpoint: body.token_endpoint,
          ...(typeof body.registration_endpoint === "string"
            ? { registration_endpoint: body.registration_endpoint }
            : {}),
          ...(Array.isArray(body.scopes_supported) ? { scopes_supported: body.scopes_supported } : {}),
          ...(Array.isArray(body.code_challenge_methods_supported)
            ? { code_challenge_methods_supported: body.code_challenge_methods_supported }
            : {}),
          ...(body.client_id_metadata_document_supported === true
            ? { client_id_metadata_document_supported: true }
            : {})
        }
      };
    } catch {
      // try next
    }
  }
  return { ok: false, reason: "authorization_server_metadata_missing" };
}

/**
 * RFC 8414: issuer に path があるときは host と path のあいだに
 * `/.well-known/oauth-authorization-server` を挿入する（Stripe: access.stripe.com/mcp）。
 */
export function authorizationServerMetadataUrls(authServerUrl: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(authServerUrl);
  } catch {
    const base = authServerUrl.replace(/\/$/, "");
    return [
      `${base}/.well-known/oauth-authorization-server`,
      `${base}/.well-known/openid-configuration`
    ];
  }
  const origin = parsed.origin;
  const path = parsed.pathname.replace(/\/$/, "");
  const base = `${origin}${path}`;
  const urls: string[] = [];
  if (path) {
    urls.push(`${origin}/.well-known/oauth-authorization-server${path}`);
    urls.push(`${origin}/.well-known/openid-configuration${path}`);
  }
  urls.push(`${base}/.well-known/oauth-authorization-server`);
  urls.push(`${base}/.well-known/openid-configuration`);
  if (path) {
    urls.push(`${origin}/.well-known/oauth-authorization-server`);
    urls.push(`${origin}/.well-known/openid-configuration`);
  }
  const seen = new Set<string>();
  return urls.filter((url) => {
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

async function registerOAuthClient(
  metadata: McpOAuthMetadata,
  redirectUri: string,
  fetchImpl: typeof fetch
): Promise<{ ok: true; clientId: string; clientSecret?: string } | { ok: false; reason: string }> {
  if (!metadata.registration_endpoint) {
    return { ok: false, reason: "registration_unsupported" };
  }
  try {
    const response = await fetchImpl(metadata.registration_endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        client_name: "Fudo",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none"
      })
    });
    if (!response.ok) {
      return { ok: false, reason: `registration_http_${response.status}` };
    }
    const body = (await response.json()) as { client_id?: string; client_secret?: string };
    if (typeof body.client_id !== "string" || !body.client_id) {
      return { ok: false, reason: "registration_missing_client_id" };
    }
    return {
      ok: true,
      clientId: body.client_id,
      ...(typeof body.client_secret === "string" ? { clientSecret: body.client_secret } : {})
    };
  } catch {
    return { ok: false, reason: "registration_unreachable" };
  }
}

async function postToken(
  tokenEndpoint: string,
  body: URLSearchParams,
  fetchImpl: typeof fetch
): Promise<
  | { ok: true; access_token: string; refresh_token?: string; expires_in?: number }
  | { ok: false; reason: string }
> {
  try {
    const response = await fetchImpl(tokenEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json"
      },
      body
    });
    if (!response.ok) return { ok: false, reason: `token_http_${response.status}` };
    const json = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (typeof json.access_token !== "string" || !json.access_token) {
      return { ok: false, reason: "token_missing" };
    }
    return {
      ok: true,
      access_token: json.access_token,
      ...(typeof json.refresh_token === "string" ? { refresh_token: json.refresh_token } : {}),
      ...(typeof json.expires_in === "number" ? { expires_in: json.expires_in } : {})
    };
  } catch {
    return { ok: false, reason: "token_unreachable" };
  }
}

function randomUrlSafe(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
