import { describe, expect, it } from "vitest";
import {
  authorizationServerMetadataUrls,
  beginMcpOAuthFlow,
  finishMcpOAuthFlow,
  packOAuthSecret,
  parseOAuthSecret,
  accessTokenFromSecret
} from "./mcp-oauth";

describe("mcp-oauth secret pack", () => {
  it("packs and parses access token", () => {
    const packed = packOAuthSecret({
      access_token: "tok",
      client_id: "cid",
      token_endpoint: "https://example.com/token",
      resource: "https://example.com"
    });
    expect(parseOAuthSecret(packed)?.access_token).toBe("tok");
    expect(accessTokenFromSecret("oauth", packed)).toBe("tok");
    expect(accessTokenFromSecret("bearer", "plain")).toBe("plain");
  });
});

describe("mcp-oauth flow", () => {
  it("discovers, registers, and exchanges with mocked fetch", async () => {
    const calls: { url: string; method: string }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url, method });
      if (url.includes("oauth-protected-resource")) {
        return jsonResponse({
          resource: "https://mcp.example.com",
          authorization_servers: ["https://auth.example.com"],
          scopes_supported: ["default"]
        });
      }
      if (url.includes("oauth-authorization-server")) {
        return jsonResponse({
          issuer: "https://auth.example.com",
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
          registration_endpoint: "https://auth.example.com/register"
        });
      }
      if (url.endsWith("/register") && method === "POST") {
        return jsonResponse({ client_id: "client-1" });
      }
      if (url.endsWith("/token") && method === "POST") {
        return jsonResponse({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600
        });
      }
      if (method === "POST" && url.includes("/mcp")) {
        return new Response(null, {
          status: 401,
          headers: {
            "www-authenticate":
              'Bearer realm="OAuth", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"'
          }
        });
      }
      return new Response("missing", { status: 404 });
    };

    const started = await beginMcpOAuthFlow({
      mcpUrl: "https://mcp.example.com/mcp",
      name: "Example",
      catalogId: "example",
      redirectUri: "http://127.0.0.1:4174/api/mcp/oauth/callback",
      publicOrigin: "http://127.0.0.1:4174",
      fetchImpl
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.authorizeUrl).toContain("https://auth.example.com/authorize?");
    expect(started.authorizeUrl).toContain("code_challenge=");
    expect(started.pending.clientId).toBe("client-1");

    const finished = await finishMcpOAuthFlow({
      pending: started.pending,
      code: "auth-code",
      state: started.pending.state,
      fetchImpl
    });
    expect(finished.ok).toBe(true);
    if (!finished.ok) return;
    expect(parseOAuthSecret(finished.secret)?.access_token).toBe("access-1");
    expect(calls.some((call) => call.url.includes("/register"))).toBe(true);
  });

  it("RFC 8414: path 付き issuer は /.well-known/…/path を先に試す（Stripe 形）", async () => {
    expect(authorizationServerMetadataUrls("https://access.stripe.com/mcp")[0]).toBe(
      "https://access.stripe.com/.well-known/oauth-authorization-server/mcp"
    );

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("oauth-protected-resource")) {
        return jsonResponse({
          resource: "https://mcp.stripe.com",
          authorization_servers: ["https://access.stripe.com/mcp"],
          scopes_supported: ["mcp"]
        });
      }
      // 誤った append 形は 404。挿入形だけ成功。
      if (url === "https://access.stripe.com/.well-known/oauth-authorization-server/mcp") {
        return jsonResponse({
          issuer: "https://access.stripe.com/mcp",
          authorization_endpoint: "https://access.stripe.com/mcp/oauth2/authorize",
          token_endpoint: "https://access.stripe.com/mcp/oauth2/token",
          registration_endpoint: "https://access.stripe.com/mcp/oauth2/register",
          code_challenge_methods_supported: ["S256"]
        });
      }
      if (url.includes("/.well-known/")) {
        return new Response("missing", { status: 404 });
      }
      if (url.includes("/oauth2/register") && method === "POST") {
        return jsonResponse({ client_id: "stripe-client" });
      }
      if (method === "POST" && url.includes("mcp.stripe.com")) {
        return new Response(null, {
          status: 401,
          headers: {
            "www-authenticate":
              'Bearer resource_metadata="https://mcp.stripe.com/.well-known/oauth-protected-resource"'
          }
        });
      }
      return new Response("missing", { status: 404 });
    };

    const started = await beginMcpOAuthFlow({
      mcpUrl: "https://mcp.stripe.com",
      name: "Stripe",
      catalogId: "stripe",
      redirectUri: "http://127.0.0.1:4174/api/mcp/oauth/callback",
      publicOrigin: "http://127.0.0.1:4174",
      fetchImpl
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.authorizeUrl).toContain("access.stripe.com/mcp/oauth2/authorize");
    expect(started.pending.clientId).toBe("stripe-client");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
