/**
 * Cloudflare Access の JWT 検証。Access の設定漏れだけで入口が開かないよう、Worker 側でも
 * 署名・発行者・対象（aud）・期限・持ち主のメールを確かめる。
 */

export type AccessConfig = {
  /** `team.cloudflareaccess.com`（https:// は付けても付けなくてもよい） */
  teamDomain: string;
  aud: string;
  ownerEmail: string;
};

export type AccessDecision =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403 | 503; reason: string };

export type AccessJwk = { kty?: string; n?: string; e?: string; kid?: string };
type Jwk = AccessJwk;
type JwksFetcher = (url: string) => Promise<{ keys: Jwk[] }>;

const JWKS_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_S = 60;
const jwksCache = new Map<string, { at: number; keys: Jwk[] }>();

export function accessConfigFromEnv(
  env: Readonly<{ CF_ACCESS_TEAM_DOMAIN?: string; CF_ACCESS_AUD?: string; FUDO_OWNER_EMAIL?: string }>
): AccessConfig | null {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "") ?? "";
  const aud = env.CF_ACCESS_AUD?.trim() ?? "";
  const ownerEmail = env.FUDO_OWNER_EMAIL?.trim().toLowerCase() ?? "";
  if (!teamDomain || !aud || !ownerEmail) return null;
  return { teamDomain, aud, ownerEmail };
}

export function isLocalRequest(request: Request): boolean {
  const host = new URL(request.url).hostname;
  return host === "127.0.0.1" || host === "localhost";
}

export function accessToken(request: Request): string | null {
  const header = request.headers.get("cf-access-jwt-assertion")?.trim();
  if (header) return header;
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

const defaultFetcher: JwksFetcher = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`jwks_${response.status}`);
  return (await response.json()) as { keys: Jwk[] };
};

async function signingKey(config: AccessConfig, kid: string, fetcher: JwksFetcher, now: number): Promise<Jwk | null> {
  const url = `https://${config.teamDomain}/cdn-cgi/access/certs`;
  const cached = jwksCache.get(url);
  const fresh = cached && now - cached.at < JWKS_TTL_MS ? cached : null;
  const hit = fresh?.keys.find((key) => key.kid === kid);
  if (hit) return hit;
  // 鍵の入れ替え直後は kid が未知になる。期限内でも1回だけ取り直す。
  const { keys } = await fetcher(url);
  jwksCache.set(url, { at: now, keys });
  return keys.find((key) => key.kid === kid) ?? null;
}

const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
const importJwk = crypto.subtle.importKey.bind(crypto.subtle) as (
  format: "jwk",
  keyData: Record<string, unknown>,
  algorithm: typeof RS256,
  extractable: boolean,
  usages: ["verify"]
) => Promise<CryptoKey>;

function base64UrlDecode(part: string): Uint8Array<ArrayBuffer> {
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(new TextDecoder().decode(base64UrlDecode(part))) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function verifyAccessJwt(
  token: string,
  config: AccessConfig,
  options: { fetcher?: JwksFetcher; now?: number } = {}
): Promise<AccessDecision> {
  const denied = (reason: string): AccessDecision => ({ ok: false, status: 403, reason });
  const parts = token.split(".");
  if (parts.length !== 3) return denied("access_token_malformed");
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const header = decodeJson(headerPart);
  const payload = decodeJson(payloadPart);
  if (!header || !payload) return denied("access_token_malformed");
  if (header.alg !== "RS256" || typeof header.kid !== "string") return denied("access_token_alg");

  const nowMs = options.now ?? Date.now();
  let jwk: Jwk | null;
  try {
    jwk = await signingKey(config, header.kid, options.fetcher ?? defaultFetcher, nowMs);
  } catch {
    return { ok: false, status: 503, reason: "access_jwks_unavailable" };
  }
  if (!jwk) return denied("access_key_unknown");
  const key = await importJwk("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, RS256, false, ["verify"]);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlDecode(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`)
  );
  if (!valid) return denied("access_signature");

  if (payload.iss !== `https://${config.teamDomain}`) return denied("access_issuer");
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(config.aud)) return denied("access_audience");
  const nowS = Math.floor(nowMs / 1000);
  if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_S < nowS) return denied("access_expired");
  if (typeof payload.nbf === "number" && payload.nbf - CLOCK_SKEW_S > nowS) return denied("access_not_yet_valid");
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (email !== config.ownerEmail) return denied("access_not_owner");
  return { ok: true, email };
}

/**
 * 手元（127.0.0.1／localhost）はそのまま通す。
 * Access の3変数が揃っているときだけ JWT を要求する。揃っていなければ開いたままにする。
 */
export async function requireOwner(
  request: Request,
  env: Readonly<{ CF_ACCESS_TEAM_DOMAIN?: string; CF_ACCESS_AUD?: string; FUDO_OWNER_EMAIL?: string }>,
  options: { fetcher?: JwksFetcher; now?: number } = {}
): Promise<Response | null> {
  if (isLocalRequest(request)) return null;
  const config = accessConfigFromEnv(env);
  if (!config) return null;
  const token = accessToken(request);
  if (!token) return deny(401, "access_required");
  const decision = await verifyAccessJwt(token, config, options);
  return decision.ok ? null : deny(decision.status, decision.reason);
}

function deny(status: number, reason: string): Response {
  return new Response(JSON.stringify({ reason }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

export function resetAccessKeyCacheForTest(): void {
  jwksCache.clear();
}
