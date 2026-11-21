/** 設定が足りずに使えない能力。値は出さず、足りない名前だけ。 */

export type CapabilityGapId = "run_agent" | "agent_repos";

export interface CapabilityGap {
  id: CapabilityGapId;
  /** 画面用の短い名前。 */
  label: string;
  missing: string[];
}

const LABELS: Record<CapabilityGapId, string> = {
  run_agent: "Claude Code",
  agent_repos: "GitHub リポジトリ連携"
};

/**
 * Worker / 手元の env から、足りない設定を列挙する。
 * `hasDocs` は R2 の書類バケットがバインディングにあるか（env 文字列では分からない）。
 */
export function capabilityGapsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  hasDocs: boolean
): CapabilityGap[] {
  const gaps: CapabilityGap[] = [];

  const agentMissing: string[] = [];
  if (!env.ANTHROPIC_API_KEY?.trim()) agentMissing.push("ANTHROPIC_API_KEY");
  if (env.FUDO_CONTAINERS !== "1") agentMissing.push("FUDO_CONTAINERS");
  if (!hasDocs) agentMissing.push("DOCS");
  if (agentMissing.length > 0) {
    gaps.push({ id: "run_agent", label: LABELS.run_agent, missing: agentMissing });
  }

  const repoMissing: string[] = [];
  if (!env.GITHUB_APP_ID?.trim()) repoMissing.push("GITHUB_APP_ID");
  if (!env.GITHUB_APP_PRIVATE_KEY?.trim()) repoMissing.push("GITHUB_APP_PRIVATE_KEY");
  if (!env.GITHUB_APP_INSTALLATION_ID?.trim()) repoMissing.push("GITHUB_APP_INSTALLATION_ID");
  const repos = (env.FUDO_AGENT_REPOS ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.includes("/"));
  if (repos.length === 0) repoMissing.push("FUDO_AGENT_REPOS");
  if (repoMissing.length > 0) {
    gaps.push({ id: "agent_repos", label: LABELS.agent_repos, missing: repoMissing });
  }

  return gaps;
}
