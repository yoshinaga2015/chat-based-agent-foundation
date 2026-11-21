/** 能力行の状態バッジ。null は表示なし。 */
export type AbilityStatus = "active" | "need_action" | "error" | null;

export type AbilityStatusBadge = {
  status: Exclude<AbilityStatus, null>;
  label: string;
  variant: "success" | "warning" | "error";
};

const BADGES: Record<Exclude<AbilityStatus, null>, AbilityStatusBadge> = {
  active: { status: "active", label: "稼働", variant: "success" },
  need_action: { status: "need_action", label: "要対応", variant: "warning" },
  error: { status: "error", label: "エラー", variant: "error" }
};

export function abilityStatusBadge(status: AbilityStatus): AbilityStatusBadge | null {
  if (!status) return null;
  return BADGES[status];
}

/** MCP 接続行の状態。優先: error > need_action > active。 */
export function mcpConnectionStatus(server: {
  needsReauth?: boolean;
  lastProbe?: { ok: boolean } | null;
}): AbilityStatus {
  if (server.lastProbe && !server.lastProbe.ok) return "error";
  if (server.needsReauth) return "need_action";
  return "active";
}
