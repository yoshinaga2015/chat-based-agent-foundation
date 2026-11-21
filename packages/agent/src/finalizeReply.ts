/**
 * ツール実行後のユーザー向け最終文。
 * 活動ストリップ（「〜した」）は進捗 UI。本文は別レイヤで必ず出す。
 */

/** 空本文のとき、テキスト専用の一回リカバリに渡す指示（ツール禁止）。 */
export const FINAL_REPORT_NUDGE =
  "ツール実行は終わった。ユーザー向けに、できたこと・止まっていること・次の一手を短い自然な日本語で書け。ツール名・内部 reason・回数の羅列はしない。空の返答は禁止。";

/**
 * モデルが空のまま終わったときの事実ベースのフォールバック。
 * 成功を捏造しない。ツール名は出さない。
 */
export function synthesizeAfterTools(toolLog: readonly unknown[]): string {
  let ok = 0;
  let fail = 0;
  for (const row of toolLog) {
    if (!row || typeof row !== "object" || !("ok" in row)) continue;
    if ((row as { ok: unknown }).ok === false) fail += 1;
    else if ((row as { ok: unknown }).ok === true) ok += 1;
  }
  if (fail > 0 && ok === 0) {
    return "途中で操作が続きませんでした。画面の状態を確認するか、必要なら操作を引き継いで進められます。";
  }
  if (fail > 0) {
    return "一部まで進みましたが、続きで止まっています。必要なら画面を渡して続きを頼めます。";
  }
  if (ok > 0) {
    return "操作は一通り終わりました。続きがあれば指示してください。";
  }
  return "作業の結果を文章にまとめられませんでした。もう一度指示をください。";
}

export function pickFinalReply(raw: string, toolLog: readonly unknown[]): string {
  const text = raw.trim();
  if (text) return text;
  if (toolLog.length === 0) return "";
  return synthesizeAfterTools(toolLog);
}
