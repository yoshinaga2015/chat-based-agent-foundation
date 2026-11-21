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
    /失敗|できな|できません|不正|無効|拒否|エラー|見つからな|見つかりません|要る|必要|無い|ありません|不足|超え|対応していない|使用できない|選べません|選択できません|入力してください|設定されていません|中断|上限|までです/.test(
      t
    )
  ) {
    return "error";
  }
  return "secondary";
}
