/**
 * 公開 fetch 本文が有料・ログイン壁っぽいか（すり抜け禁止 → 次 URL）。
 * 金融専用にしない。短い本文＋壁シグナルで判定。
 */

const WALL_SIGNAL =
  /subscribe\s+to\s+(continue|read|unlock|view)|paywall|sign[\s-]?in\s+to\s+(continue|read|view|see)|log\s*in\s+to\s+(continue|read|view)|create\s+(an\s+)?account\s+to|members?\s+only|remaining\s+free\s+articles|metered\s+paywall|有料会員|会員登録|ログインして続き|この記事の続きは|続きを読むには|購読者限定/i;

export function detectContentWall(markdown: string): boolean {
  const text = markdown.replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (!WALL_SIGNAL.test(text)) return false;
  // 壁文言があっても長文の本文が取れていれば精読成功とみなす
  if (text.length >= 1_200) return false;
  return true;
}
