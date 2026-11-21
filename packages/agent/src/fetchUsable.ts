/**
 * 精読本文が根拠として使えないか（ホスト非依存）。
 * 壁（content_wall）とは別：エラーページ・空・ボット拒否テンプレ等。
 */

const UNUSABLE_SIGNAL =
  /oops[,\s].*went\s+wrong|something\s+went\s+wrong|access\s+denied|permission\s+denied|403\s+forbidden|404\s+not\s+found|page\s+not\s+found|not\s+found\.?\s*$|enable\s+javascript|please\s+enable\s+(cookies|js|javascript)|javascript\s+(is\s+)?required|just\s+a\s+moment[\s.…]|attention\s+required|checking\s+your\s+browser|verify\s+you\s+are\s+(a\s+)?human|are\s+you\s+a\s+robot|cf-browser-verification|rate\s+limit(ed)?|too\s+many\s+requests|service\s+unavailable|temporarily\s+unavailable|error\s+code\s*[:：]?\s*\d{3}|an\s+error\s+occurred|unexpected\s+error|リクエストが集中|アクセスが集中|ページが見つかりません|アクセスできません|エラーが発生|一時的に利用できません/i;

/** 短〜中程度の本文で障害シグナルがある、または空。長文は誤検知を避ける。 */
export function detectUnusableFetch(markdown: string): boolean {
  const text = markdown.replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (!UNUSABLE_SIGNAL.test(text)) return false;
  if (text.length >= 1_200) return false;
  return true;
}
