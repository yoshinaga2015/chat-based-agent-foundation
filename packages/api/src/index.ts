import "./domain";
import { mcpClientIdMetadataDocument } from "agent";
import { requireOwner } from "./access";
import { handleApi } from "./routes";
export { BrowserAct } from "./browser-act-do";
export { SessionDO } from "./session-do";
export { UserSandbox } from "./user-sandbox";
export { AnthropicEgress } from "./agent-egress";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }
    // MCP の認可サーバが取りに来る公開メタデータ。秘密を含まない。
    if (request.method === "GET" && url.pathname === "/oauth/mcp-client.json") {
      const origin = request.headers.get("Origin") || `${url.protocol}//${url.host}`;
      // 公開オリジンはブラウザ側（4174）。Worker 直叩き時は自身。
      const publicOrigin = origin.includes("4175") ? origin.replace(":4175", ":4174") : origin;
      const doc = mcpClientIdMetadataDocument(publicOrigin, [
        new URL("/api/mcp/oauth/callback", publicOrigin).toString()
      ]);
      return new Response(JSON.stringify(doc), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=300"
        }
      });
    }
    const denied = await requireOwner(request, env);
    if (denied) return denied;
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, 40, ctx);
    }
    if (!env.ASSETS) return new Response("not found", { status: 404 });
    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
