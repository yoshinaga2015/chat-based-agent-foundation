import { describe, expect, it } from "vitest";
import { isSealedMcpSecret, openMcpSecret, sealMcpSecret } from "./mcp-secret-crypto";
import { httpMcpTransport } from "./mcp";

function procEnv(): Record<string, string | undefined> {
  const root = globalThis as { process?: { env?: Record<string, string | undefined> } };
  if (!root.process) root.process = { env: {} };
  if (!root.process.env) root.process.env = {};
  return root.process.env;
}

describe("mcp-secret-crypto", () => {
  it("キーが無ければ拒否（平文は明示オプトインのみ）", async () => {
    const env = procEnv();
    const prevAllow = env.FUDO_MCP_ALLOW_PLAINTEXT;
    delete env.FUDO_MCP_ALLOW_PLAINTEXT;
    // 第2引数 "" で env の鍵を無視して「鍵無し」を強制
    await expect(sealMcpSecret("tok-plain", "")).rejects.toThrow(/mcp_secret_key_missing/);
    env.FUDO_MCP_ALLOW_PLAINTEXT = "1";
    const plain = await sealMcpSecret("tok-plain", "");
    expect(plain).toBe("tok-plain");
    expect(await openMcpSecret(plain, "")).toBe("tok-plain");
    if (prevAllow === undefined) delete env.FUDO_MCP_ALLOW_PLAINTEXT;
    else env.FUDO_MCP_ALLOW_PLAINTEXT = prevAllow;
  });

  it("AES-GCM で封じ・開ける", async () => {
    const key = "test-secret-key-material";
    const sealed = await sealMcpSecret("super-secret", key);
    expect(isSealedMcpSecret(sealed)).toBe(true);
    expect(sealed).not.toContain("super-secret");
    expect(await openMcpSecret(sealed, key)).toBe("super-secret");
  });
});

describe("MCP HTTP エラー本文", () => {
  it("400 の JSON-RPC message を reason に載せる", async () => {
    procEnv().FUDO_MCP_ALLOW_PLAINTEXT = "1";
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "App is not enabled for Slack MCP server access" }
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    const listed = await httpMcpTransport(fetchImpl).listTools({
      id: "slack",
      name: "Slack",
      url: "https://mcp.slack.com/mcp",
      auth: "oauth",
      secret: JSON.stringify({
        access_token: "xoxp-a",
        client_id: "c",
        token_endpoint: "https://slack.com/api/oauth.v2.user.access",
        resource: "https://mcp.slack.com"
      })
    });
    expect(listed.ok).toBe(false);
    if (listed.ok) return;
    expect(listed.reason).toContain("App is not enabled for Slack MCP server access");
  });
});

describe("401 reauth", () => {
  it("401 で needsReauth になり秘密を外す", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(null, {
        status: 401,
        headers: {
          "www-authenticate": 'Bearer error="invalid_token", scope="repo"'
        }
      });
    const transport = httpMcpTransport(fetchImpl);
    const listed = await transport.listTools({
      id: "demo",
      name: "demo",
      url: "https://mcp.example.com/mcp",
      auth: "oauth",
      secret: JSON.stringify({
        access_token: "a",
        client_id: "c",
        token_endpoint: "https://example.com/token",
        resource: "https://mcp.example.com"
      })
    });
    expect(listed.ok).toBe(false);
    if (listed.ok) return;
    expect(listed.reason).toBe("oauth_reauth");
    expect(listed.server?.needsReauth).toBe(true);
    expect(listed.server?.secret).toBeUndefined();
    expect(listed.server?.reauthScope).toBe("repo");
  });

  it("insufficient_scope では秘密を残して再認可を示す", async () => {
    procEnv().FUDO_MCP_ALLOW_PLAINTEXT = "1";
    let step = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { method?: string } : {};
      if (body.method === "initialize") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26" } }), {
          status: 200,
          headers: { "content-type": "application/json", "mcp-session-id": "s1" }
        });
      }
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      step += 1;
      return new Response(null, {
        status: 403,
        headers: { "www-authenticate": 'Bearer error="insufficient_scope", scope="repo read:org"' }
      });
    };
    const transport = httpMcpTransport(fetchImpl);
    const listed = await transport.listTools({
      id: "demo",
      name: "demo",
      url: "https://mcp.example.com/mcp",
      auth: "oauth",
      secret: JSON.stringify({
        access_token: "a",
        client_id: "c",
        token_endpoint: "https://example.com/token",
        resource: "https://mcp.example.com"
      })
    });
    expect(listed.ok).toBe(false);
    if (listed.ok) return;
    expect(listed.reason).toBe("insufficient_scope");
    expect(listed.server?.needsReauth).toBe(true);
    expect(listed.server?.secret).toBeTruthy();
    expect(listed.server?.reauthScope).toContain("repo");
    expect(step).toBeGreaterThan(0);
  });
});
