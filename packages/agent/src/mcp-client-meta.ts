/** OAuth Client ID Metadata Document（CIMD）と事前 client_id 解決。 */

export type McpClientIdMetadata = {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "none";
  application_type: "web";
};

/** 製品オリジン上の CIMD URL。client_id はこの URL そのもの。 */
export function mcpClientIdMetadataUrl(publicOrigin: string): string {
  return new URL("/oauth/mcp-client.json", ensureOrigin(publicOrigin)).toString();
}

export function mcpClientIdMetadataDocument(
  publicOrigin: string,
  redirectUris: readonly string[]
): McpClientIdMetadata {
  const origin = ensureOrigin(publicOrigin);
  const clientId = mcpClientIdMetadataUrl(origin);
  const redirects = redirectUris.length > 0
    ? [...redirectUris]
    : [new URL("/api/mcp/oauth/callback", origin).toString()];
  return {
    client_id: clientId,
    client_name: "Fudo",
    redirect_uris: redirects,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "web"
  };
}

/** 環境の事前登録。例: FUDO_MCP_OAUTH_CLIENT_GITHUB=... */
export function preRegisteredOAuthClient(
  catalogId: string | undefined,
  env: Record<string, string | undefined> = envBag()
): { clientId: string; clientSecret?: string } | null {
  if (!catalogId) return null;
  const suffix = catalogId.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  if (!suffix) return null;
  const clientId = env[`FUDO_MCP_OAUTH_CLIENT_${suffix}`]?.trim();
  if (!clientId) return null;
  const clientSecret = env[`FUDO_MCP_OAUTH_SECRET_${suffix}`]?.trim();
  return { clientId, ...(clientSecret ? { clientSecret } : {}) };
}

function ensureOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    return "http://127.0.0.1:4174";
  }
}

function envBag(): Record<string, string | undefined> {
  try {
    return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  } catch {
    return {};
  }
}
