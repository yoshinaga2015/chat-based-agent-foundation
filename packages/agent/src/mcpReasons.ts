/** MCP probe / 接続失敗 reason → 能力ペイン向け簡潔な専門用語・ステータス。未知は短くそのまま。 */

const KNOWN: Record<string, string> = {
  oauth_required: "OAuth 未接続",
  oauth_reauth: "再認証が必要",
  bearer_required: "Bearer トークン未設定",
  http_401: "認証エラー",
  insufficient_scope: "権限不足（スコープ不足）",
  host_denied: "許可ホスト外",
  private_host: "プライベートホスト指定不可",
  invalid_url: "URL 形式不正",
  unavailable: "サービス利用不可",
  mcp_unreachable: "サーバー応答なし",
  mcp_error: "プロトコルエラー",
  sse_empty: "空のレスポンス",
  timeout: "タイムアウト",
  secret_unlock_failed: "認証情報の復号エラー",
  token_refreshed: "トークン更新（再試行中）",
  token_unreachable: "トークン取得失敗",
  prm_unreachable: "認証メタデータ取得失敗"
};

export function formatMcpProbeReason(reason: string): string {
  const key = reason.trim();
  if (!key) return "失敗";
  if (KNOWN[key]) return KNOWN[key];
  if (/^http_\d+$/.test(key)) {
    return `HTTP ${key.replace("http_", "")} エラー`;
  }
  return key.slice(0, 80);
}
