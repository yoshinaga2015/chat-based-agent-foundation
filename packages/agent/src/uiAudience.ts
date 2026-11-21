/**
 * ユーザー面 / ハーネス面の分離。
 * @see docs/design/2026-11-02-user-vs-harness-surfaces.md
 */

export type UiPartAudience = "user" | "internal";

/** 既定でチャットに出さない kind（テレメトリ・評価用 stamp）。 */
const INTERNAL_BY_KIND = new Set<string>(["job_progress"]);

export function audienceForUiPartKind(kind: string): UiPartAudience {
  return INTERNAL_BY_KIND.has(kind) ? "internal" : "user";
}

/** チャット描画してよいか。meta.audience が優先、無ければ kind 既定。 */
export function isUserFacingUiPart(part: {
  kind: string;
  audience?: UiPartAudience;
}): boolean {
  if (part.audience === "internal") return false;
  if (part.audience === "user") return true;
  return audienceForUiPartKind(part.kind) === "user";
}
