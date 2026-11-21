/** Kumo Banner の variant。成功・情報を error（赤）にしない。 */
export type NoticeBannerVariant = "default" | "alert" | "error" | "secondary";

/**
 * 卓 notice の一文から Banner 色を決める。
 * 失敗・阻止は error。接続成功など確認は default。その他の案内は secondary。
 */
export function noticeBannerVariant(notice: string): NoticeBannerVariant {
  const t = notice.trim();
  if (/^接続 OK\b/.test(t)) return "default";
  if (
    /失敗|できない|不正|拒否|エラー|見つからない|要る|無い|破棄|接続を開始できない/.test(t)
  ) {
    return "error";
  }
  return "secondary";
}
