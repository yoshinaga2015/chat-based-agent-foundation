import { parseCliAllowList, validateCliArgv, type CliRunResult, type CliRunner } from "./cli";
import {
  applyPendingMcp,
  labelPendingMcp,
  removeMcp,
  resolveMcpHostAllow,
  saveMcp,
  toolNamesFromList,
  type McpServer,
  type McpTransport,
  type PendingMcp
} from "./mcp";

export type McpCliEnv = {
  mcpServers: McpServer[];
  mcpHostAllow: readonly string[];
  mcpUserHosts?: readonly string[];
  cliAllow: readonly string[];
  pendingMcp: PendingMcp | null;
  planText: string | null;
  pendingDelete: unknown;
  planPending: boolean;
  allowDestructive?: boolean;
  cli?: (argv: string[]) => CliRunResult;
  cliRunner?: CliRunner;
  mcp?: McpTransport;
};

export function mcpHostAllowFromEnv(
  env: Record<string, string | undefined> = {},
  userHosts: readonly string[] = []
): string[] {
  return resolveMcpHostAllow(env.FUDO_MCP_HOST_ALLOW, userHosts);
}

export function cliAllowFromEnv(env: Record<string, string | undefined> = {}): string[] {
  return parseCliAllowList(env.FUDO_CLI_ALLOW);
}

export function runCliTool(state: McpCliEnv, args: unknown): CliRunResult | Promise<CliRunResult> {
  const argv = args && typeof args === "object" && "argv" in args ? (args as { argv: unknown }).argv : undefined;
  const checked = validateCliArgv(argv, state.cliAllow);
  if (!checked.ok) return { ok: false, reason: "invalid_value", detail: { constraint: checked.constraint } };
  if (state.cli) return state.cli(checked.argv);
  if (state.cliRunner) return state.cliRunner(checked.argv);
  return { ok: false, reason: "cli_unavailable", detail: { constraint: "この環境では CLI を実行できない" } };
}

export async function mcpListToolsTool(state: McpCliEnv, args: unknown): Promise<unknown> {
  if (!state.mcp) return { ok: false, reason: "mcp_unavailable", detail: { constraint: "MCP 輸送が無い" } };
  const key = args && typeof args === "object" && "server" in args && typeof (args as { server: unknown }).server === "string"
    ? (args as { server: string }).server.trim()
    : "";
  const targets = key
    ? state.mcpServers.filter((server) => server.id === key || server.name === key)
    : state.mcpServers;
  if (key && targets.length === 0) return { ok: false, reason: "invalid_value", detail: { constraint: "サーバが見つからない" } };
  const rows = [];
  for (const server of targets) {
    const listed = await state.mcp.listTools(server);
    if (listed.server) replaceMcpServer(state.mcpServers, listed.server);
    rows.push({ server: server.id, name: server.name, ...(listed.ok ? { ok: true, tools: listed.tools } : { ok: false, reason: listed.reason }) });
  }
  return { ok: true, servers: rows };
}

export async function mcpCallTool(state: McpCliEnv, args: unknown): Promise<unknown> {
  if (!state.mcp) return { ok: false, reason: "mcp_unavailable", detail: { constraint: "MCP 輸送が無い" } };
  if (!args || typeof args !== "object") return { ok: false, reason: "invalid_value", detail: { constraint: "server と name が要る" } };
  const serverKey = "server" in args && typeof args.server === "string" ? args.server.trim() : "";
  const name = "name" in args && typeof args.name === "string" ? args.name.trim() : "";
  const callArgs = "arguments" in args ? args.arguments : {};
  if (!serverKey || !name) return { ok: false, reason: "invalid_value", detail: { constraint: "server と name が要る" } };
  const server = state.mcpServers.find((item) => item.id === serverKey || item.name === serverKey);
  if (!server) return { ok: false, reason: "invalid_value", detail: { constraint: "サーバが見つからない" } };
  const listed = await state.mcp.listTools(server);
  if (listed.server) replaceMcpServer(state.mcpServers, listed.server);
  if (!listed.ok) return { ok: false, reason: listed.reason };
  if (!toolNamesFromList(listed.tools).includes(name)) {
    return { ok: false, reason: "invalid_value", detail: { constraint: `tools/list に ${name} が無い` } };
  }
  const live = state.mcpServers.find((item) => item.id === server.id) ?? listed.server ?? server;
  const called = await state.mcp.callTool(live, name, callArgs);
  if (called.server) replaceMcpServer(state.mcpServers, called.server);
  if (!called.ok) return { ok: false, reason: called.reason };
  return { ok: true, result: called.result };
}

function replaceMcpServer(servers: McpServer[], next: McpServer): void {
  const index = servers.findIndex((item) => item.id === next.id);
  if (index >= 0) servers[index] = next;
}

export type ConfigureDraft = {
  mcpServers: McpServer[];
  mcpUserHosts?: string[];
  pendingMcp: PendingMcp | null;
  planText: string | null;
  pendingDelete: unknown;
};

export function mcpConfigureTool(
  state: McpCliEnv,
  draft: ConfigureDraft,
  args: unknown
): unknown {
  if (!args || typeof args !== "object" || !("op" in args) || typeof args.op !== "string") {
    return { ok: false, reason: "invalid_value", detail: { constraint: "op は list / upsert / remove" } };
  }
  if (args.op === "list") {
    return {
      ok: true,
      servers: draft.mcpServers.map((server) => ({
        id: server.id,
        name: server.name,
        url: server.url,
        auth: server.auth,
        hasSecret: Boolean(server.secret)
      }))
    };
  }
  if (state.planPending || draft.planText || draft.pendingDelete || draft.pendingMcp) {
    return { ok: false, reason: "plan_pending", detail: {} };
  }
  if (args.op === "upsert") {
    const catalogId = "catalogId" in args && typeof args.catalogId === "string" ? args.catalogId : undefined;
    const confirmUnknownHost = "confirmUnknownHost" in args && args.confirmUnknownHost === true;
    // 対話経路は HITL がホスト確認になる。能力ペイン即時は confirmUnknownHost が要る。
    const saved = saveMcp(
      draft.mcpServers,
      {
        id: "id" in args && typeof args.id === "string" ? args.id : undefined,
        name: "name" in args && typeof args.name === "string" ? args.name : undefined,
        url: "url" in args && typeof args.url === "string" ? args.url : undefined,
        auth: "auth" in args && (args.auth === "none" || args.auth === "bearer" || args.auth === "oauth")
          ? args.auth
          : undefined,
        secret: "secret" in args && typeof args.secret === "string" ? args.secret : undefined,
        catalogId,
        confirmUnknownHost: Boolean(confirmUnknownHost || !state.allowDestructive)
      },
      state.mcpHostAllow
    );
    if (!saved.ok) return saved;
    const server = saved.servers[saved.servers.length - 1]!;
    if (state.allowDestructive) {
      draft.mcpServers = saved.servers;
      if (saved.grantHost && draft.mcpUserHosts && !draft.mcpUserHosts.includes(saved.grantHost)) {
        draft.mcpUserHosts.push(saved.grantHost);
      }
      return { ok: true, accepted: true, server: { id: server.id, name: server.name, url: server.url, auth: server.auth } };
    }
    const pending: PendingMcp = {
      op: "upsert",
      server,
      ...(saved.grantHost ? { grantHost: saved.grantHost } : {})
    };
    draft.pendingMcp = pending;
    draft.planText = labelPendingMcp(pending);
    return { ok: true, accepted: true, plan_pending: true, note: "承認待ち" };
  }
  if (args.op === "remove") {
    const id = "id" in args && typeof args.id === "string" ? args.id : "";
    const removed = removeMcp(draft.mcpServers, id);
    if (!removed.ok) return removed;
    if (state.allowDestructive) {
      draft.mcpServers = removed.servers;
      return { ok: true, accepted: true, removed: id };
    }
    const pending: PendingMcp = { op: "remove", id: id.trim() };
    draft.pendingMcp = pending;
    draft.planText = labelPendingMcp(pending);
    return { ok: true, accepted: true, plan_pending: true, note: "承認待ち" };
  }
  return { ok: false, reason: "invalid_value", detail: { constraint: "op は list / upsert / remove" } };
}

export { applyPendingMcp, labelPendingMcp };
