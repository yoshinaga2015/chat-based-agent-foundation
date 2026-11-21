/** 著名 Remote MCP の名簿。ツール一覧は固定せず tools/list に従う。 */

import { preRegisteredOAuthClient } from "./mcp-client-meta";

export type McpAuthKind = "none" | "bearer" | "oauth";

/** Bearer 入力で「何を・どこで取るか」を誤らないための案内。スローガンではなく操作制約。 */
export type McpBearerHint = {
  label: string;
  /** 発行場所（製品内の画面パス相当） */
  where: string;
  /** 発行画面 URL（あれば「発行する」リンク） */
  createUrl?: string;
  placeholder?: string;
};

export type McpCatalogEntry = {
  id: string;
  name: string;
  url: string;
  /** 接続に使う認証の候補。先頭が既定。 */
  auth: readonly McpAuthKind[];
  /** auth に bearer があるときの入力案内 */
  bearer?: McpBearerHint;
  /**
   * AS が DCR／CIMD 非対応で、製品の事前登録 client が必須なとき。
   * `FUDO_MCP_OAUTH_CLIENT_<ID>` が無いとカタログから出さない。
   */
  oauthRequiresPreRegisteredClient?: boolean;
};

export const MCP_CATALOG: readonly McpCatalogEntry[] = [
  { id: "notion", name: "Notion", url: "https://mcp.notion.com/mcp", auth: ["oauth"] },
  {
    id: "linear",
    name: "Linear",
    url: "https://mcp.linear.app/mcp",
    auth: ["oauth", "bearer"],
    bearer: {
      label: "API キー",
      where: "Linear → Settings → Account → Security & Access",
      createUrl: "https://linear.app/settings/account/security",
      placeholder: "lin_api_…"
    }
  },
  // GitHub AS は DCR 非対応。既定は Bearer（PAT）。OAuth は固定 client を持つときのみ。
  {
    id: "github",
    name: "GitHub",
    url: "https://api.githubcopilot.com/mcp/",
    auth: ["bearer", "oauth"],
    bearer: {
      label: "個人用アクセス トークン",
      where: "GitHub → Settings → Developer settings → Personal access tokens",
      createUrl: "https://github.com/settings/personal-access-tokens/new",
      placeholder: "ghp_… / github_pat_…"
    }
  },
  {
    id: "stripe",
    name: "Stripe",
    url: "https://mcp.stripe.com",
    auth: ["oauth", "bearer"],
    bearer: {
      label: "シークレットキー",
      where: "Stripe Dashboard → Developers → API keys",
      createUrl: "https://dashboard.stripe.com/apikeys",
      placeholder: "sk_… / rk_…"
    }
  },
  { id: "atlassian", name: "Atlassian", url: "https://mcp.atlassian.com/v2/mcp", auth: ["oauth"] },
  { id: "sentry", name: "Sentry", url: "https://mcp.sentry.dev/mcp", auth: ["oauth"] },
  {
    id: "supabase",
    name: "Supabase",
    url: "https://mcp.supabase.com/mcp",
    auth: ["oauth", "bearer"],
    bearer: {
      label: "Personal Access Token",
      where: "Supabase Dashboard → Account → Access Tokens",
      createUrl: "https://supabase.com/dashboard/account/tokens",
      placeholder: "sbp_…"
    }
  },
  // Figma の DCR は許可クライアント名の allowlist（Claude Code 等のみ）。
  // 「Fudo」は 403。なりすましはせず、Figma MCP カタログ承認後の事前 client が要る。
  {
    id: "figma",
    name: "Figma",
    url: "https://mcp.figma.com/mcp",
    auth: ["oauth"],
    oauthRequiresPreRegisteredClient: true
  },
  // Slack 公式は DCR／CIMD 非対応。confidential 事前 client（FUDO_MCP_OAUTH_CLIENT_SLACK）必須。
  {
    id: "slack",
    name: "Slack",
    url: "https://mcp.slack.com/mcp",
    auth: ["oauth"],
    oauthRequiresPreRegisteredClient: true
  }
] as const;

/** 自由登録（カタログ外）の Bearer 案内 */
export const MCP_FREE_BEARER_HINT: McpBearerHint = {
  label: "Bearer トークン",
  where: "接続先 MCP が要求する Authorization: Bearer の値",
  placeholder: "…"
};

export function catalogById(id: string): McpCatalogEntry | undefined {
  return MCP_CATALOG.find((entry) => entry.id === id);
}

export function catalogHosts(): string[] {
  const hosts = new Set<string>();
  for (const entry of MCP_CATALOG) {
    try {
      hosts.add(new URL(entry.url).hostname.toLowerCase());
    } catch {
      // skip bad catalog row
    }
  }
  return [...hosts];
}

export function mergeMcpHosts(...lists: readonly (readonly string[])[]): string[] {
  const hosts = new Set<string>();
  for (const list of lists) {
    for (const host of list) {
      const trimmed = host.trim().toLowerCase();
      if (trimmed) hosts.add(trimmed);
    }
  }
  return [...hosts];
}

export function isHostAllowed(hostname: string, allowHosts: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return allowHosts.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/** 接続を完遂できる行だけ返す（事前 client 必須で未設定の行は出さない）。 */
export function publicCatalog(
  env: Record<string, string | undefined> = envBag()
): {
  id: string;
  name: string;
  url: string;
  auth: McpAuthKind[];
  bearer?: McpBearerHint;
}[] {
  return MCP_CATALOG.filter((entry) => catalogEntryConnectable(entry, env)).map((entry) => ({
    id: entry.id,
    name: entry.name,
    url: entry.url,
    auth: [...entry.auth],
    ...(entry.bearer ? { bearer: entry.bearer } : {})
  }));
}

export function catalogEntryConnectable(
  entry: Pick<McpCatalogEntry, "id" | "auth" | "oauthRequiresPreRegisteredClient">,
  env: Record<string, string | undefined> = envBag()
): boolean {
  if (!entry.oauthRequiresPreRegisteredClient) return true;
  if (entry.auth.includes("bearer") || entry.auth.includes("none")) return true;
  return preRegisteredOAuthClient(entry.id, env) !== null;
}

function envBag(): Record<string, string | undefined> {
  try {
    return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  } catch {
    return {};
  }
}
