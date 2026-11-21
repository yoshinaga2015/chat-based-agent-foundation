import { installAi } from "agent";

/** Worker の env を process.env へ写す（session / agent が process.env を読むため）。 */
export function applyProcessEnv(env: Env): void {
  const root = globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  };
  if (!root.process) root.process = { env: {} };
  if (!root.process.env) root.process.env = {};
  const bag = root.process.env;
  const keys = [
    "AGENT_CHAT_MODEL",
    "FUDO_DAILY_TOKEN_CAP",
    "FUDO_BUILD_ID",
    "FUDO_MCP_HOST_ALLOW",
    "FUDO_BROWSER_HOST_ALLOW",
    "FUDO_ALLOWED_ORIGINS",
    "FUDO_BROWSER_BACKEND",
    "FUDO_BROWSER_ACT_URL",
    "FUDO_BROWSER_STEEL_FALLBACK_URL",
    "FUDO_BROWSER_ACT_TOKEN",
    "STEEL_API_KEY",
    "STEEL_BASE_URL",
    "STEEL_USE_PROXY",
    "STEEL_PROXY_COUNTRY",
    "STEEL_PROXY_URL",
    "FUDO_CLI_ALLOW",
    "FUDO_AGENT_ALLOW",
    "FUDO_MCP_SECRET_KEY",
    "FUDO_MCP_OAUTH_CLIENT_GITHUB",
    "FUDO_MCP_OAUTH_SECRET_GITHUB",
    "FUDO_MCP_OAUTH_CLIENT_SLACK",
    "FUDO_MCP_OAUTH_SECRET_SLACK",
    "FUDO_MCP_OAUTH_CLIENT_FIGMA",
    "FUDO_MCP_OAUTH_SECRET_FIGMA"
  ] as const;
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) bag[key] = value;
  }
}

/** 対話・検索・判定はすべて env.AI を gateway "default" 経由で呼ぶ。キーは持たない。 */
export function applyAi(env: Env): void {
  const ai = env.AI;
  installAi({
    run: (model, input) => ai.run(model, input, { gateway: { id: "default" } }),
    websearch: (request) => ai.websearch({ gatewayId: "default", ...request })
  });
}
