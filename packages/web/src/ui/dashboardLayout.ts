/** Dashboard レイアウト個人化（UI State）。契約 UiPart は触らない。 */
import type { DashboardWidget } from "../types";

export const DASHBOARD_LAYOUT_SCHEMA = 1 as const;

export type DashboardLayoutPrefs = {
  schemaVersion: typeof DASHBOARD_LAYOUT_SCHEMA;
  order: string[];
  span: Record<string, 1 | 2>;
  hidden: string[];
};

const STORAGE_PREFIX = "fudo.dashboardLayout.v1:";

export function dashboardLayoutKey(title: string, widgetIds: string[]): string {
  const ids = [...widgetIds].sort().join(",");
  return `${STORAGE_PREFIX}${title}::${ids}`;
}

export function emptyDashboardLayout(widgetIds: string[]): DashboardLayoutPrefs {
  return {
    schemaVersion: DASHBOARD_LAYOUT_SCHEMA,
    order: [...widgetIds],
    span: {},
    hidden: []
  };
}

export function readDashboardLayout(key: string): DashboardLayoutPrefs | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DashboardLayoutPrefs>;
    if (parsed.schemaVersion !== DASHBOARD_LAYOUT_SCHEMA) return null;
    if (!Array.isArray(parsed.order) || !parsed.span || !Array.isArray(parsed.hidden)) return null;
    return {
      schemaVersion: DASHBOARD_LAYOUT_SCHEMA,
      order: parsed.order.filter((id): id is string => typeof id === "string"),
      span: Object.fromEntries(
        Object.entries(parsed.span).flatMap(([id, span]) =>
          span === 1 || span === 2 ? [[id, span] as const] : []
        )
      ),
      hidden: parsed.hidden.filter((id): id is string => typeof id === "string")
    };
  } catch {
    return null;
  }
}

export function writeDashboardLayout(key: string, prefs: DashboardLayoutPrefs): void {
  try {
    localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    /* quota / private mode */
  }
}

/**
 * 現行 widgets に prefs を載せる。
 * 消えた id は捨て、未知 id は末尾。span 未指定はマッパの span。
 */
export function reconcileDashboardLayout(
  widgets: DashboardWidget[],
  prefs: DashboardLayoutPrefs | null
): { visible: DashboardWidget[]; prefs: DashboardLayoutPrefs } {
  const byId = new Map(widgets.map((w) => [w.id, w]));
  const order: string[] = [];
  if (prefs) {
    for (const id of prefs.order) {
      if (byId.has(id) && !order.includes(id)) order.push(id);
    }
  }
  for (const w of widgets) {
    if (!order.includes(w.id)) order.push(w.id);
  }
  const span: Record<string, 1 | 2> = {};
  for (const id of order) {
    const w = byId.get(id)!;
    const saved = prefs?.span[id];
    span[id] = saved === 1 || saved === 2 ? saved : w.span;
  }
  const hidden = (prefs?.hidden ?? []).filter((id) => byId.has(id));
  const nextPrefs: DashboardLayoutPrefs = {
    schemaVersion: DASHBOARD_LAYOUT_SCHEMA,
    order,
    span,
    hidden
  };
  const visible = order
    .filter((id) => !hidden.includes(id))
    .map((id) => {
      const w = byId.get(id)!;
      return { ...w, span: span[id]! };
    });
  return { visible, prefs: nextPrefs };
}

export type WidgetDropPlace = "before" | "after";

/** toId の前／後ろへ fromId を差し込む。CSS grid の「右に置く」は after。 */
export function moveWidgetOrder(
  order: string[],
  fromId: string,
  toId: string,
  place: WidgetDropPlace = "before"
): string[] {
  if (fromId === toId) return order;
  const next = order.filter((id) => id !== fromId);
  let at = next.indexOf(toId);
  if (at < 0) return order;
  if (place === "after") at += 1;
  next.splice(at, 0, fromId);
  return next;
}

/** スロット内ポインタ位置 → 挿入側。横長は左右、縦長は上下。 */
export function dropPlaceFromPointer(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number }
): WidgetDropPlace {
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (rect.width >= rect.height * 0.55) {
    return x < rect.width / 2 ? "before" : "after";
  }
  return y < rect.height / 2 ? "before" : "after";
}

export function shiftWidgetOrder(order: string[], id: string, delta: -1 | 1): string[] {
  const i = order.indexOf(id);
  if (i < 0) return order;
  const j = i + delta;
  if (j < 0 || j >= order.length) return order;
  const next = [...order];
  const tmp = next[i]!;
  next[i] = next[j]!;
  next[j] = tmp;
  return next;
}
