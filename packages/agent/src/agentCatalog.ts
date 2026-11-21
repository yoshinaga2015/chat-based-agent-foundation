/** 外部 CLI エージェントのカタログ。ChatToolDef は増やさず id だけ増やす。 */

export type AgentCatalogEntry = {
  id: string;
  name: string;
  /** 実行先が起動するバイナリ名（パス不可）。 */
  bin: string;
};

export const AGENT_CATALOG: readonly AgentCatalogEntry[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    bin: "claude"
  }
];

export function agentCatalogEntry(id: string): AgentCatalogEntry | null {
  const key = id.trim();
  return AGENT_CATALOG.find((row) => row.id === key) ?? null;
}

export function parseAgentAllowList(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return AGENT_CATALOG.map((row) => row.id);
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function agentAllowFromEnv(env: Record<string, string | undefined> = {}): string[] {
  return parseAgentAllowList(env.FUDO_AGENT_ALLOW);
}
