/** GenUI 向きジョブ用 tool。kind をモデルに選ばせず、ジョブ tool → マッパ。 */
import { UI_ITEMS_MAX } from "./uiParts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}


/** 手順追跡用。一度きりの助言リストではない（description で分離）。 */
export function presentChecklistTool(args: unknown): unknown {
  if (!isRecord(args) || !Array.isArray(args.items)) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "items 配列が要る" } };
  }
  const items: { id: string; label: string; state: "pending"; cardId?: string }[] = [];
  const seen = new Set<string>();
  for (const row of args.items) {
    if (!isRecord(row)) continue;
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (!label) continue;
    const rawId = typeof row.id === "string" ? row.id.trim() : "";
    const id = rawId || `step-${items.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const rawCard =
      typeof row.cardId === "string" ? row.cardId.trim().slice(0, 64) : "";
    const item: { id: string; label: string; state: "pending"; cardId?: string } = {
      id,
      label: label.slice(0, 48),
      state: "pending"
    };
    if (rawCard) item.cardId = rawCard;
    items.push(item);
    if (items.length >= UI_ITEMS_MAX) break;
  }
  if (items.length < 2) {
    return { ok: false, reason: "need_two_items", detail: { constraint: "項目は2件以上" } };
  }
  const title = typeof args.title === "string" && args.title.trim() ? args.title.trim().slice(0, 48) : undefined;
  return title ? { ok: true, title, items } : { ok: true, items };
}

/** 外で使う文案プレビュー。読めば足りる説明には使わない。 */
export function presentDraftTool(args: unknown): unknown {
  if (!isRecord(args) || typeof args.body !== "string") {
    return { ok: false, reason: "invalid_value", detail: { constraint: "body が要る" } };
  }
  const body = args.body.trim();
  if (!body) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "body が空" } };
  }
  const title = typeof args.title === "string" && args.title.trim() ? args.title.trim().slice(0, 48) : undefined;
  return title
    ? { ok: true, title, body: body.slice(0, 4000) }
    : { ok: true, body: body.slice(0, 4000) };
}
