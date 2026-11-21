import { describe, expect, it } from "vitest";
import { httpMcpTransport, parseSseJsonRpc } from "./mcp";
import { mcpClientIdMetadataDocument, mcpClientIdMetadataUrl, preRegisteredOAuthClient } from "./mcp-client-meta";
import { resolveOAuthClient } from "./mcp-oauth";

describe("parseSseJsonRpc", () => {
  it("SSE から JSON-RPC result を拾う", () => {
    const text = [
      "event: message",
      'data: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"a"}]}}',
      "",
      ""
    ].join("\n");
    expect(parseSseJsonRpc(text)).toMatchObject({ result: { tools: [{ name: "a" }] } });
  });
});

describe("CIMD / 事前 client", () => {
  it("CIMD URL はオリジン上の固定パス", () => {
    expect(mcpClientIdMetadataUrl("http://127.0.0.1:4174")).toBe(
      "http://127.0.0.1:4174/oauth/mcp-client.json"
    );
    const doc = mcpClientIdMetadataDocument("http://127.0.0.1:4174", [
      "http://127.0.0.1:4174/api/mcp/oauth/callback"
    ]);
    expect(doc.client_id).toBe(doc.client_id);
    expect(doc.redirect_uris[0]).toContain("/api/mcp/oauth/callback");
  });

  it("事前登録 → CIMD → DCR の順", async () => {
    const pre = await resolveOAuthClient({
      metadata: {
        issuer: "https://as.example",
        authorization_endpoint: "https://as.example/auth",
        token_endpoint: "https://as.example/token",
        registration_endpoint: "https://as.example/register",
        client_id_metadata_document_supported: true
      },
      redirectUri: "http://127.0.0.1:4174/api/mcp/oauth/callback",
      publicOrigin: "http://127.0.0.1:4174",
      catalogId: "github",
      env: { FUDO_MCP_OAUTH_CLIENT_GITHUB: "static-client" }
    });
    expect(pre).toEqual({ ok: true, clientId: "static-client" });

    // loopback では CIMD を使わず DCR へ（AS が localhost を fetch できない）。
    const dcrOnLocal = await resolveOAuthClient({
      metadata: {
        issuer: "https://as.example",
        authorization_endpoint: "https://as.example/auth",
        token_endpoint: "https://as.example/token",
        registration_endpoint: "https://as.example/register",
        client_id_metadata_document_supported: true
      },
      redirectUri: "http://127.0.0.1:4174/api/mcp/oauth/callback",
      publicOrigin: "http://127.0.0.1:4174",
      fetchImpl: async () =>
        new Response(JSON.stringify({ client_id: "dcr-local" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    });
    expect(dcrOnLocal).toEqual({ ok: true, clientId: "dcr-local" });

    const cimd = await resolveOAuthClient({
      metadata: {
        issuer: "https://as.example",
        authorization_endpoint: "https://as.example/auth",
        token_endpoint: "https://as.example/token",
        client_id_metadata_document_supported: true
      },
      redirectUri: "https://app.example.com/api/mcp/oauth/callback",
      publicOrigin: "https://app.example.com"
    });
    expect(cimd).toEqual({ ok: true, clientId: "https://app.example.com/oauth/mcp-client.json" });

    expect(preRegisteredOAuthClient("github", {})).toBeNull();
  });
});

describe("httpMcpTransport initialize + session", () => {
  it("initialize のち tools/list に session を付ける", async () => {
    const calls: { method?: string; session?: string | null }[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { method?: string } : {};
      const headers = new Headers(init?.headers);
      calls.push({ method: body.method, session: headers.get("mcp-session-id") });
      if (body.method === "initialize") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26" } }), {
          status: 200,
          headers: { "content-type": "application/json", "mcp-session-id": "sess-1" }
        });
      }
      if (body.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      if (body.method === "tools/list") {
        expect(headers.get("mcp-session-id")).toBe("sess-1");
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "x" }] } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response("no", { status: 404 });
    };

    const transport = httpMcpTransport(fetchImpl);
    const listed = await transport.listTools({
      id: "demo",
      name: "demo",
      url: "https://mcp.example.com/mcp",
      auth: "none"
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.tools).toEqual([{ name: "x" }]);
    expect(listed.server.sessionId).toBe("sess-1");
    expect(calls.map((c) => c.method)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
  });
});
