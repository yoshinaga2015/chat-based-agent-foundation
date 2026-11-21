import { beforeEach, describe, expect, it } from "vitest";
import { accessToken, requireOwner, resetAccessKeyCacheForTest, verifyAccessJwt, type AccessConfig, type AccessJwk } from "./access";
import { rejectBadOrigin } from "./security";

const config: AccessConfig = { teamDomain: "team.cloudflareaccess.com", aud: "aud-123", ownerEmail: "owner@example.com" };
const env = { CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", CF_ACCESS_AUD: "aud-123", FUDO_OWNER_EMAIL: "Owner@Example.com" };
const NOW = 1_800_000_000_000;

function b64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let binary = "";
  for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type KeyPair = { privateKey: CryptoKey; publicKey: CryptoKey };

async function keyPair() {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  ) as Promise<KeyPair>;
}

async function sign(privateKey: CryptoKey, payload: Record<string, unknown>, kid = "k1"): Promise<string> {
  const head = b64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(signature))}`;
}

const claims = (overrides: Record<string, unknown> = {}) => ({
  iss: "https://team.cloudflareaccess.com",
  aud: ["aud-123"],
  email: "owner@example.com",
  exp: NOW / 1000 + 600,
  nbf: NOW / 1000 - 10,
  ...overrides
});

let pair: KeyPair;
let fetcher: (url: string) => Promise<{ keys: AccessJwk[] }>;
let fetched: string[];

beforeEach(async () => {
  resetAccessKeyCacheForTest();
  pair = await keyPair();
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as AccessJwk;
  fetched = [];
  fetcher = async (url) => {
    fetched.push(url);
    return { keys: [{ ...jwk, kid: "k1" }] };
  };
});

describe("verifyAccessJwt", () => {
  it("accepts the owner's token and caches the keys", async () => {
    const token = await sign(pair.privateKey, claims());
    expect(await verifyAccessJwt(token, config, { fetcher, now: NOW })).toEqual({ ok: true, email: "owner@example.com" });
    await verifyAccessJwt(token, config, { fetcher, now: NOW });
    expect(fetched).toEqual(["https://team.cloudflareaccess.com/cdn-cgi/access/certs"]);
  });

  it.each([
    ["another account", { email: "someone@example.com" }, "access_not_owner"],
    ["a service token without email", { email: undefined, common_name: "svc" }, "access_not_owner"],
    ["another application", { aud: ["other"] }, "access_audience"],
    ["another team", { iss: "https://evil.cloudflareaccess.com" }, "access_issuer"],
    ["an expired token", { exp: NOW / 1000 - 120 }, "access_expired"]
  ])("rejects %s", async (_label, overrides, reason) => {
    const token = await sign(pair.privateKey, claims(overrides));
    expect(await verifyAccessJwt(token, config, { fetcher, now: NOW })).toEqual({ ok: false, status: 403, reason });
  });

  it("rejects a token signed by another key", async () => {
    const other = await keyPair();
    const token = await sign(other.privateKey, claims());
    expect(await verifyAccessJwt(token, config, { fetcher, now: NOW })).toMatchObject({ ok: false, reason: "access_signature" });
  });

  it("rejects alg none and unknown kids", async () => {
    const none = `${b64url(JSON.stringify({ alg: "none", kid: "k1" }))}.${b64url(JSON.stringify(claims()))}.`;
    expect(await verifyAccessJwt(none, config, { fetcher, now: NOW })).toMatchObject({ ok: false, reason: "access_token_alg" });
    const unknown = await sign(pair.privateKey, claims(), "k9");
    expect(await verifyAccessJwt(unknown, config, { fetcher, now: NOW })).toMatchObject({ ok: false, reason: "access_key_unknown" });
  });

  it("stops with 503 when the keys cannot be fetched", async () => {
    const token = await sign(pair.privateKey, claims());
    const failing = async () => {
      throw new Error("down");
    };
    expect(await verifyAccessJwt(token, config, { fetcher: failing, now: NOW })).toEqual({
      ok: false,
      status: 503,
      reason: "access_jwks_unavailable"
    });
  });
});

describe("requireOwner", () => {
  const remote = (headers: Record<string, string> = {}) => new Request("https://fudo.example.com/api/session", { headers });

  it("lets local development through", async () => {
    expect(await requireOwner(new Request("http://127.0.0.1:4175/api/session"), {})).toBeNull();
  });

  it("stays open when Access is not configured", async () => {
    expect(await requireOwner(remote(), {})).toBeNull();
  });

  it("requires a token", async () => {
    const response = await requireOwner(remote(), env, { fetcher, now: NOW });
    expect(response?.status).toBe(401);
  });

  it("accepts the header or the CF_Authorization cookie", async () => {
    const token = await sign(pair.privateKey, claims());
    expect(await requireOwner(remote({ "cf-access-jwt-assertion": token }), env, { fetcher, now: NOW })).toBeNull();
    expect(await requireOwner(remote({ cookie: `a=b; CF_Authorization=${token}` }), env, { fetcher, now: NOW })).toBeNull();
    expect(accessToken(remote({ cookie: "a=b" }))).toBeNull();
  });

  it("refuses another account", async () => {
    const token = await sign(pair.privateKey, claims({ email: "someone@example.com" }));
    const response = await requireOwner(remote({ "cf-access-jwt-assertion": token }), env, { fetcher, now: NOW });
    expect(response?.status).toBe(403);
  });
});

describe("rejectBadOrigin", () => {
  it("accepts the same origin as the deployed Worker", () => {
    const request = new Request("https://fudo.example.com/api/speak", { method: "POST", headers: { origin: "https://fudo.example.com" } });
    expect(rejectBadOrigin(request)).toBeNull();
  });

  it("rejects a foreign origin", () => {
    const request = new Request("https://fudo.example.com/api/speak", { method: "POST", headers: { origin: "https://evil.example.com" } });
    expect(rejectBadOrigin(request)?.status).toBe(403);
  });
});
