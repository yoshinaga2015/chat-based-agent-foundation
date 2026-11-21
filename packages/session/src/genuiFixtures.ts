/**
 * Flow／回帰用のデモ内容だけ。契約・描画・本番短絡には載せない。
 * 本番の checklist／draft は present_checklist / present_draft（LLM tool）が埋める。
 */
export const FIXTURE_SITE_VISIT_CHECKLIST = {
  items: [
    { id: "exterior", label: "外観", state: "pending" as const },
    { id: "boundary", label: "境界", state: "pending" as const },
    { id: "area", label: "周辺", state: "pending" as const },
    { id: "photos", label: "写真", state: "pending" as const }
  ]
};

export function fixtureOwnerContactDraft(propertyLabel?: string): { body: string } {
  const name = propertyLabel?.trim() || "ご物件";
  return {
    body: `${name}について確認させてください。\n価格・賃料・空室の最新状況を教えていただけますか。\nよろしくお願いいたします。`
  };
}
