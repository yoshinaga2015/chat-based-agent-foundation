/** Generative UI: ツール結果 → チャットに載せる UiPart（決定的マッパ）。 */

import { domainPack } from "./domain";
import {
  mediaFromUnknown,
  mergeMediaImages,
  normalizeHitMedia,
  type MediaImage
} from "./media";
import { haversineMeters } from "./places";

export const UI_PART_MAX = 3;
export const UI_ITEMS_MAX = 8;
export const DASHBOARD_METRICS_MAX = 4;
export const DASHBOARD_WIDGETS_MAX = 6;

export type { MediaImage };

/** Controlled chartType（web ChartPart と同集合）。 */
export type ChartType =
  | "line"
  | "area"
  | "bar"
  | "bar_horizontal"
  | "pie"
  | "donut"
  | "coxcomb"
  | "scatter"
  | "radar"
  | "funnel"
  | "gauge"
  | "heatmap"
  | "treemap"
  | "sunburst"
  | "boxplot"
  | "candlestick"
  | "sankey"
  | "graph"
  | "waterfall"
  | "ohlc"
  | "volume"
  | "drawdown"
  | "equity_drawdown"
  | "bullet"
  | "tornado"
  | "heikin_ashi"
  | "renko"
  | "point_figure"
  | "volume_profile"
  | "histogram"
  | "density"
  | "ecdf"
  | "violin"
  | "qq"
  | "errorbar"
  | "forest"
  | "hexbin"
  | "contour"
  | "ridgeline"
  | "pareto";

export const CHART_TYPES: readonly ChartType[] = [
  "line",
  "area",
  "bar",
  "bar_horizontal",
  "pie",
  "donut",
  "coxcomb",
  "scatter",
  "radar",
  "funnel",
  "gauge",
  "heatmap",
  "treemap",
  "sunburst",
  "boxplot",
  "candlestick",
  "sankey",
  "graph",
  "waterfall",
  "ohlc",
  "volume",
  "drawdown",
  "equity_drawdown",
  "bullet",
  "tornado",
  "heikin_ashi",
  "renko",
  "point_figure",
  "volume_profile",
  "histogram",
  "density",
  "ecdf",
  "violin",
  "qq",
  "errorbar",
  "forest",
  "hexbin",
  "contour",
  "ridgeline",
  "pareto"
] as const;

export {
  CHART_TIER_CORE,
  CHART_TIER_EXTENDED,
  CHART_TIER_EXPERIMENTAL,
  chartTierOf,
  isCoreChartType,
  type ChartTier
} from "./chartTiers";

/** 構造化列経路ができるまで emit しない（描画・dashboard ネストは残す）。 */
export const COMPARE_TABLE_EMIT = false;

/** フォーム値。assumptions は数値のみ採る。他は speak_summary 向け。 */
export type FormValue = string | number | boolean | string[];

export const FORM_FIELD_TYPES = [
  "text",
  "number",
  "currency",
  "textarea",
  "select",
  "radio",
  "stepper",
  "slider",
  "checkbox",
  "switch",
  "date",
  "sensitive",
  "tags"
] as const;

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export type FormField = {
  id: string;
  label: string;
  type: FormFieldType;
  options?: string[];
  value?: FormValue;
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
  /** 同一カード内グリッド。1=半幅、2=全幅。省略時は型の既定。 */
  span?: 1 | 2;
};

export type FormsSection = {
  id: string;
  title?: string;
  /** 互換用。描画は縦積みカード内の欄 span のみ。 */
  span: 1 | 2;
  fields: FormField[];
};

/** ドメイン非依存 KPI。文言はマッパが埋める。 */
export type DashboardMetric = {
  id: string;
  label: string;
  value: string;
  tone?: "default" | "positive" | "negative";
};

export type ChartPartBody = {
  kind: "chart";
  title?: string;
  chartType: ChartType;
  categories?: string[];
  series: {
    name: string;
    data: number[];
    errors?: number[];
    ciLow?: number[];
    ciHigh?: number[];
  }[];
  links?: { source: string; target: string; value: number }[];
  nodes?: { name: string; value?: number }[];
};

export type CompareTablePartBody = {
  kind: "compare_table";
  columns: { id: string; label: string }[];
  rows: { id: string; cells: Record<string, string | number | null> }[];
};

export type DashboardWidget = {
  id: string;
  span: 1 | 2;
  title?: string;
  body: ChartPartBody | CompareTablePartBody | { kind: "metrics"; items: DashboardMetric[] };
};

/** 出典・鮮度（任意）。見た目トークンではない。 */
export type UiPartMeta = {
  producedAt?: number;
  sourceTool?: string;
  /** 省略時は kind 既定（job_progress は internal）。@see uiAudience */
  audience?: "user" | "internal";
};

type UiPartBody =
  | {
      kind: "picks";
      items: {
        id: string;
        title: string;
        detail?: string;
        url?: string;
        imageUrl?: string;
        images?: MediaImage[];
        meta?: string;
        badge?: string;
      }[];
    }
  | {
      kind: "sources";
      items: { title: string; url: string; snippet?: string }[];
    }
  | {
      /** 調査ターンの進捗（決定的スタンプ）。モデル tool ではない。 */
      kind: "job_progress";
      phases: {
        id: "plan" | "search" | "fetch" | "synthesize" | "delegate";
        label: string;
        state: "pending" | "active" | "done" | "skipped";
      }[];
      meters: {
        id: "web_search" | "browser_fetch" | "delegate";
        label: string;
        used: number;
        max: number;
      }[];
    }
  | {
      /** Web 精読の日付付き数値（見るジョブ）。不動産専用にしない。 */
      kind: "fact_rows";
      title?: string;
      sourceUrl?: string;
      rows: { id: string; label: string; value: string; asOf?: string }[];
    }
  | {
      kind: "ledger_figures";
      items: { id: string; title: string; value: number | null }[];
    }
  | {
      kind: "kanban_snip";
      cards: { id: string; title: string; state: string }[];
    }
  | ChartPartBody
  | CompareTablePartBody
  | {
      kind: "dashboard";
      title: string;
      metrics?: DashboardMetric[];
      widgets: DashboardWidget[];
    }
  | {
      /** @deprecated 本番欠損は forms。旧メッセージ描画用に残す。 */
      kind: "form_fields";
      title?: string;
      fields: FormField[];
      commit: "assumptions" | "speak_summary";
      submitLabel?: string;
    }
  | {
      kind: "forms";
      title: string;
      sections: FormsSection[];
      commit: "assumptions" | "speak_summary";
      submitLabel?: string;
    }
  | {
      kind: "place_list";
      items: {
        id: string;
        title: string;
        distanceM: number;
        durationS?: number;
        kind?: string;
        url?: string;
        imageUrl?: string;
        lat?: number;
        lng?: number;
      }[];
    }
  | {
      kind: "map_snip";
      center: { lat: number; lng: number };
      zoom?: number;
      markers: { id: string; lat: number; lng: number; label?: string }[];
      route?: {
        profile: "foot" | "bike" | "car";
        distanceM: number;
        durationS: number;
        coordinates: { lat: number; lng: number }[];
      };
    }
  | {
      kind: "checklist";
      title?: string;
      items: {
        id: string;
        label: string;
        state: "pending" | "done" | "blocked";
        /** 任意。既存カンバンカードへのソフトリンク（サーバ検証しない）。 */
        cardId?: string;
      }[];
    }
  | {
      kind: "draft_preview";
      title?: string;
      body: string;
    };

export type UiPart = UiPartBody & UiPartMeta;

export type ChecklistItemState = Extract<UiPart, { kind: "checklist" }>["items"][number]["state"];

export type CompareTableRow = {
  id: string;
  cells: Record<string, string | number | null>;
};

/** 汎用核。揃った行が2件未満なら出さない。 */
export function mapRowsToCompareTable(
  columns: { id: string; label: string }[],
  rows: CompareTableRow[]
): UiPart[] {
  if (columns.length < 2 || rows.length < 2) return [];
  return [
    {
      kind: "compare_table",
      columns,
      rows: rows.slice(0, UI_ITEMS_MAX)
    }
  ];
}

export type PickItem = Extract<UiPart, { kind: "picks" }>["items"][number];
export type PlaceItem = Extract<UiPart, { kind: "place_list" }>["items"][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function httpsUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text.toLowerCase().startsWith("https://")) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function hostTitle(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function clipSnippet(raw: unknown, max = 160): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function clipTitle(raw: string, max = 72): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return text;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** web_search は「選ぶ」ジョブ。出典トレースは browser_fetch → sources。 */
function mapWebSearch(result: unknown): UiPart[] {
  if (!isRecord(result) || result.ok !== true || !Array.isArray(result.results)) return [];
  const items: PickItem[] = [];
  for (const row of result.results) {
    if (!isRecord(row)) continue;
    const url = httpsUrl(row.url);
    if (!url) continue;
    const rawTitle =
      typeof row.title === "string" && row.title.trim() ? row.title.trim() : hostTitle(url);
    const title = clipTitle(rawTitle);
    const detail = clipSnippet(row.snippet, 96);
    const media = normalizeHitMedia({
      imageUrl: httpsUrl(row.imageUrl ?? row.image ?? row.thumbnail) ?? undefined,
      images: mergeMediaImages(
        Array.isArray(row.images) ? mediaFromUnknown(row.images) : undefined,
        mediaFromUnknown(row.image)
      )
    });
    const meta =
      typeof row.meta === "string" && row.meta.trim() ? clipSnippet(row.meta, 48) : undefined;
    const badge =
      typeof row.badge === "string" && row.badge.trim() ? clipSnippet(row.badge, 24) : undefined;
    const item: PickItem = { id: url, title, url, ...media };
    if (detail) item.detail = detail;
    if (meta) item.meta = meta;
    if (badge) item.badge = badge;
    items.push(item);
    if (items.length >= UI_ITEMS_MAX) break;
  }
  if (!items.length) return [];
  // compare_table は picks の二度出しにしない。比べるは価格・利回り等の列が取れる経路だけ。
  return [{ kind: "picks", items }];
}

export function finiteSeries(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
}

export function yearLabels(length: number): string[] {
  const n = Math.min(Math.max(length, 0), 40);
  return Array.from({ length: n }, (_, i) => String(i + 1));
}

export function formatYenMetric(n: number): string {
  return `${Math.round(n).toLocaleString("ja-JP")}円`;
}

export function clampDashboard(part: Extract<UiPart, { kind: "dashboard" }>): Extract<UiPart, { kind: "dashboard" }> {
  const metrics = (part.metrics ?? []).slice(0, DASHBOARD_METRICS_MAX);
  const widgets = part.widgets.slice(0, DASHBOARD_WIDGETS_MAX).map((w) => {
    if (w.body.kind === "metrics") {
      return {
        ...w,
        body: { kind: "metrics" as const, items: w.body.items.slice(0, DASHBOARD_METRICS_MAX) }
      };
    }
    return w;
  });
  return {
    kind: "dashboard",
    title: part.title,
    ...(metrics.length ? { metrics } : {}),
    widgets
  };
}

function mapResolvePlaces(result: unknown): UiPart[] {
  if (!isRecord(result) || result.ok !== true || !Array.isArray(result.places)) return [];
  const items: PlaceItem[] = [];
  const markers: { id: string; lat: number; lng: number; label?: string }[] = [];
  for (const row of result.places) {
    if (!isRecord(row)) continue;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const distanceM =
      typeof row.distanceM === "number" && Number.isFinite(row.distanceM) ? row.distanceM : null;
    if (!id || !title || distanceM === null || distanceM < 0) continue;
    const item: PlaceItem = { id, title, distanceM };
    if (typeof row.kind === "string" && row.kind.trim()) item.kind = row.kind.trim();
    const url = httpsUrl(row.url);
    if (url) item.url = url;
    if (typeof row.lat === "number" && typeof row.lng === "number") {
      item.lat = row.lat;
      item.lng = row.lng;
      markers.push({ id, lat: row.lat, lng: row.lng, label: title });
    }
    items.push(item);
    if (items.length >= UI_ITEMS_MAX) break;
  }
  if (!items.length) return [];
  const parts: UiPart[] = [{ kind: "place_list", items }];
  const origin = isRecord(result.origin) ? result.origin : null;
  if (
    markers.length &&
    origin &&
    typeof origin.lat === "number" &&
    typeof origin.lng === "number"
  ) {
    parts.push({
      kind: "map_snip",
      center: { lat: origin.lat, lng: origin.lng },
      zoom: 13,
      markers
    });
  }
  return parts;
}

function routePointCoords(raw: unknown): { id: string; title: string; lat: number; lng: number } | null {
  if (!isRecord(raw)) return null;
  const lat = typeof raw.lat === "number" && Number.isFinite(raw.lat) ? raw.lat : null;
  const lng = typeof raw.lng === "number" && Number.isFinite(raw.lng) ? raw.lng : null;
  if (lat === null || lng === null) return null;
  const title =
    typeof raw.title === "string" && raw.title.trim()
      ? raw.title.trim()
      : typeof raw.label === "string" && raw.label.trim()
        ? raw.label.trim()
        : "地点";
  const id =
    typeof raw.id === "string" && raw.id.trim()
      ? raw.id.trim()
      : `${lat.toFixed(5)},${lng.toFixed(5)}`;
  return { id, title, lat, lng };
}

/** 曖昧な端点: 経路は張らず候補＋地図。採用で1件選ばせる。 */
function mapResolveRouteAmbiguous(result: Record<string, unknown>): UiPart[] {
  if (result.reason !== "ambiguous" || !Array.isArray(result.candidates)) return [];
  const origin = routePointCoords(result.origin);
  const items: PlaceItem[] = [];
  const markers: { id: string; lat: number; lng: number; label?: string }[] = [];
  if (origin) {
    markers.push({ id: origin.id, lat: origin.lat, lng: origin.lng, label: origin.title });
  }
  for (const row of result.candidates) {
    const point = routePointCoords(row);
    if (!point) continue;
    const distanceM = origin ? Math.round(haversineMeters(origin, point)) : 0;
    // 一覧は候補のみ（起点マーカーは採用対象外）
    items.push({
      id: point.id,
      title: point.title,
      distanceM,
      kind: "候補",
      lat: point.lat,
      lng: point.lng
    });
    markers.push({ id: point.id, lat: point.lat, lng: point.lng, label: point.title });
    if (items.length >= UI_ITEMS_MAX) break;
  }
  if (!items.length) return [];
  const center = origin
    ? { lat: origin.lat, lng: origin.lng }
    : { lat: items[0]!.lat!, lng: items[0]!.lng! };
  return [
    { kind: "place_list", items },
    { kind: "map_snip", center, zoom: 11, markers }
  ];
}

function mapResolveRoute(result: unknown): UiPart[] {
  if (!isRecord(result)) return [];
  if (result.ok === false && result.reason === "ambiguous") {
    return mapResolveRouteAmbiguous(result);
  }
  if (result.ok !== true) return [];
  const origin = isRecord(result.origin) ? result.origin : null;
  const destination = isRecord(result.destination) ? result.destination : null;
  if (!origin || !destination) return [];
  const oLat = typeof origin.lat === "number" ? origin.lat : null;
  const oLng = typeof origin.lng === "number" ? origin.lng : null;
  const dLat = typeof destination.lat === "number" ? destination.lat : null;
  const dLng = typeof destination.lng === "number" ? destination.lng : null;
  if (oLat === null || oLng === null || dLat === null || dLng === null) return [];
  const oTitle = typeof origin.title === "string" && origin.title.trim() ? origin.title.trim() : "起点";
  const dTitle =
    typeof destination.title === "string" && destination.title.trim()
      ? destination.title.trim()
      : "終点";
  const oId = typeof origin.id === "string" && origin.id.trim() ? origin.id.trim() : "origin";
  const dId =
    typeof destination.id === "string" && destination.id.trim() ? destination.id.trim() : "destination";
  const distanceM =
    typeof result.distanceM === "number" && Number.isFinite(result.distanceM) ? result.distanceM : null;
  const durationS =
    typeof result.durationS === "number" && Number.isFinite(result.durationS) ? result.durationS : 0;
  if (distanceM === null || distanceM < 0) return [];
  const profile =
    result.profile === "bike" || result.profile === "car" || result.profile === "foot"
      ? result.profile
      : "foot";
  const coordinates: { lat: number; lng: number }[] = [];
  if (Array.isArray(result.coordinates)) {
    for (const row of result.coordinates) {
      if (!isRecord(row)) continue;
      if (typeof row.lat !== "number" || typeof row.lng !== "number") continue;
      coordinates.push({ lat: row.lat, lng: row.lng });
      if (coordinates.length >= 400) break;
    }
  }
  if (coordinates.length < 2) return [];
  const profileLabel = profile === "foot" ? "徒歩" : profile === "bike" ? "自転車" : "車";
  return [
    {
      kind: "place_list",
      items: [
        { id: oId, title: oTitle, distanceM: 0, kind: "起点", lat: oLat, lng: oLng },
        {
          id: dId,
          title: dTitle,
          distanceM,
          durationS,
          kind: profileLabel,
          lat: dLat,
          lng: dLng
        }
      ]
    },
    {
      kind: "map_snip",
      center: { lat: (oLat + dLat) / 2, lng: (oLng + dLng) / 2 },
      zoom: 14,
      markers: [
        { id: oId, lat: oLat, lng: oLng, label: oTitle },
        { id: dId, lat: dLat, lng: dLng, label: dTitle }
      ],
      route: { profile, distanceM, durationS, coordinates }
    }
  ];
}

function mapFactRowsFromFetch(result: unknown, sourceUrl: string, title: string): UiPart | null {
  if (!isRecord(result) || !Array.isArray(result.facts)) return null;
  const rows: { id: string; label: string; value: string; asOf?: string }[] = [];
  for (const row of result.facts) {
    if (!isRecord(row)) continue;
    const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : `f${rows.length + 1}`;
    const label = typeof row.label === "string" ? row.label.trim() : "";
    const value = typeof row.value === "string" ? row.value.trim() : "";
    if (!label || !value) continue;
    const asOf = typeof row.asOf === "string" && row.asOf.trim() ? row.asOf.trim() : undefined;
    rows.push(asOf ? { id, label, value, asOf } : { id, label, value });
    if (rows.length >= UI_ITEMS_MAX) break;
  }
  if (!rows.length) return null;
  return { kind: "fact_rows", title, sourceUrl, rows };
}

function mapBrowserFetch(result: unknown): UiPart[] {
  if (!isRecord(result) || result.ok !== true) return [];
  const payload = isRecord(result.result) ? result.result : result;
  const url =
    httpsUrl(payload.finalUrl) ?? httpsUrl(payload.url) ?? httpsUrl(result.finalUrl) ?? httpsUrl(result.url);
  if (!url) return [];
  const title =
    typeof payload.title === "string" && payload.title.trim()
      ? payload.title.trim()
      : hostTitle(url);
  const snippet = clipSnippet(payload.markdown ?? payload.snippet);
  const parts: UiPart[] = [
    { kind: "sources", items: [snippet ? { title, url, snippet } : { title, url }] }
  ];
  const facts = mapFactRowsFromFetch(result, url, title);
  if (facts) parts.unshift(facts);
  return parts;
}

function mapReadRecords(result: unknown): UiPart[] {
  if (!isRecord(result) || result.ok !== true) return [];
  const items: { id: string; title: string; value: number | null }[] = [];

  if (isRecord(result.record)) {
    const id = typeof result.record.id === "string" ? result.record.id.trim() : "";
    if (!id) return [];
    if ("memo_body" in result.record) return [];
    const title =
      typeof result.record.title === "string" && result.record.title.trim()
        ? result.record.title.trim()
        : id;
    const value = typeof result.record.value === "number" && Number.isFinite(result.record.value)
      ? result.record.value
      : null;
    return [{ kind: "ledger_figures", items: [{ id, title, value }] }];
  }

  if (!Array.isArray(result.records)) return [];
  for (const row of result.records) {
    if (!isRecord(row)) continue;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) continue;
    const title =
      typeof row.title === "string" && row.title.trim() ? row.title.trim() : id;
    const value =
      typeof row.value === "number" && Number.isFinite(row.value) ? row.value : null;
    items.push({ id, title, value });
    if (items.length >= UI_ITEMS_MAX) break;
  }
  return items.length ? [{ kind: "ledger_figures", items }] : [];
}

function mapKanban(result: unknown): UiPart[] {
  if (!isRecord(result) || result.ok !== true) return [];
  const id = typeof result.id === "string" ? result.id.trim() : "";
  if (!id) return [];
  const title =
    typeof result.title === "string" && result.title.trim()
      ? result.title.trim()
      : id;
  const state =
    typeof result.state === "string" && result.state.trim() ? result.state.trim() : "未着手";
  return [{ kind: "kanban_snip", cards: [{ id, title, state }] }];
}

/** 1ツール結果 → 0個以上の UiPart（上限前）。 */
export function mapToolToUiParts(name: string, _args: unknown, result: unknown): UiPart[] {
  let parts: UiPart[] = [];
  switch (name) {
    case "web_search":
      parts = mapWebSearch(result);
      break;
    case "browser_fetch":
      parts = mapBrowserFetch(result);
      break;
    case "read_records":
      parts = mapReadRecords(result);
      break;
    case "kanban_add":
    case "kanban_update":
      parts = mapKanban(result);
      break;
    case "run_calc":
      parts = domainPack().mapCalcResult?.(result) ?? [];
      break;
    case "resolve_places":
      parts = mapResolvePlaces(result);
      break;
    case "resolve_route":
      parts = mapResolveRoute(result);
      break;
    case "compare_rows":
      parts = mapCompareRowsResult(result);
      break;
    case "present_checklist":
      parts = mapPresentChecklistResult(result);
      break;
    case "present_draft":
      parts = mapPresentDraftResult(result);
      break;
    default:
      return [];
  }
  return stampUiParts(parts, { sourceTool: name, producedAt: Date.now() });
}

function mapCompareRowsResult(result: unknown): UiPart[] {
  if (!isRecord(result) || result.ok !== true) return [];
  if (!Array.isArray(result.columns) || !Array.isArray(result.rows)) return [];
  const columns: { id: string; label: string }[] = [];
  for (const col of result.columns) {
    if (!isRecord(col) || typeof col.id !== "string" || typeof col.label !== "string") continue;
    columns.push({ id: col.id, label: col.label });
  }
  const rows: CompareTableRow[] = [];
  for (const row of result.rows) {
    if (!isRecord(row) || typeof row.id !== "string" || !isRecord(row.cells)) continue;
    const cells: Record<string, string | number | null> = {};
    for (const [key, value] of Object.entries(row.cells)) {
      if (typeof value === "string" || typeof value === "number" || value === null) {
        cells[key] = value;
      }
    }
    rows.push({ id: row.id, cells });
  }
  return mapRowsToCompareTable(columns, rows);
}

function mapPresentChecklistResult(result: unknown): UiPart[] {
  if (!isRecord(result) || result.ok !== true || !Array.isArray(result.items)) return [];
  const items: {
    id: string;
    label: string;
    state: "pending" | "done" | "blocked";
    cardId?: string;
  }[] = [];
  for (const row of result.items) {
    if (!isRecord(row) || typeof row.id !== "string" || typeof row.label !== "string") continue;
    const state =
      row.state === "done" || row.state === "blocked" || row.state === "pending" ? row.state : "pending";
    const cardId =
      typeof row.cardId === "string" && row.cardId.trim() ? row.cardId.trim().slice(0, 64) : undefined;
    items.push(cardId ? { id: row.id, label: row.label, state, cardId } : { id: row.id, label: row.label, state });
    if (items.length >= UI_ITEMS_MAX) break;
  }
  if (items.length < 2) return [];
  const title = typeof result.title === "string" ? result.title : undefined;
  return title ? [{ kind: "checklist", title, items }] : [{ kind: "checklist", items }];
}

function mapPresentDraftResult(result: unknown): UiPart[] {
  if (!isRecord(result) || result.ok !== true || typeof result.body !== "string") return [];
  const body = result.body.trim();
  if (!body) return [];
  const title = typeof result.title === "string" ? result.title : undefined;
  return title ? [{ kind: "draft_preview", title, body }] : [{ kind: "draft_preview", body }];
}

export function stampUiParts(parts: readonly UiPart[], meta: UiPartMeta): UiPart[] {
  return parts.map((part) => ({
    ...part,
    producedAt: part.producedAt ?? meta.producedAt,
    sourceTool: part.sourceTool ?? meta.sourceTool,
    audience: part.audience ?? meta.audience
  }));
}

const UI_KINDS = new Set([
  "picks",
  "sources",
  "job_progress",
  "fact_rows",
  "ledger_figures",
  "kanban_snip",
  "chart",
  "compare_table",
  "dashboard",
  "form_fields",
  "forms",
  "place_list",
  "map_snip",
  "checklist",
  "draft_preview"
]);

/** hydrate 時: 不正 kind / 必須欠落を落とす。 */
export function sanitizeUiParts(raw: unknown): UiPart[] {
  if (!Array.isArray(raw)) return [];
  const out: UiPart[] = [];
  for (const row of raw) {
    if (!isRecord(row) || typeof row.kind !== "string" || !UI_KINDS.has(row.kind)) continue;
    if (row.kind === "chart") {
      if (typeof row.chartType !== "string" || !(CHART_TYPES as readonly string[]).includes(row.chartType)) {
        continue;
      }
    }
    if (row.kind === "dashboard") {
      if (typeof row.title !== "string" || !Array.isArray(row.widgets)) continue;
    }
    if (row.kind === "forms") {
      if (typeof row.title !== "string" || !Array.isArray(row.sections)) continue;
    }
    if (row.kind === "form_fields") {
      if (!Array.isArray(row.fields)) continue;
    }
    if (row.kind === "checklist") {
      if (!Array.isArray(row.items)) continue;
    }
    if (row.kind === "fact_rows") {
      if (!Array.isArray(row.rows)) continue;
    }
    if (row.kind === "job_progress") {
      if (!Array.isArray(row.phases) || !Array.isArray(row.meters)) continue;
    }
    if (row.kind === "draft_preview") {
      if (typeof row.body !== "string") continue;
    }
    out.push(row as UiPart);
    if (out.length >= UI_PART_MAX) break;
  }
  return out;
}

function mergePicks(parts: Extract<UiPart, { kind: "picks" }>[]): Extract<UiPart, { kind: "picks" }> | null {
  const seen = new Set<string>();
  const items: PickItem[] = [];
  for (const part of parts) {
    for (const item of part.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
      if (items.length >= UI_ITEMS_MAX) break;
    }
    if (items.length >= UI_ITEMS_MAX) break;
  }
  return items.length ? { kind: "picks", items } : null;
}

function mergeSources(parts: Extract<UiPart, { kind: "sources" }>[]): Extract<UiPart, { kind: "sources" }> | null {
  const seen = new Set<string>();
  const items: { title: string; url: string; snippet?: string }[] = [];
  for (const part of parts) {
    for (const item of part.items) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      items.push(item);
      if (items.length >= UI_ITEMS_MAX) break;
    }
    if (items.length >= UI_ITEMS_MAX) break;
  }
  return items.length ? { kind: "sources", items } : null;
}

function mergeFactRows(
  parts: Extract<UiPart, { kind: "fact_rows" }>[]
): Extract<UiPart, { kind: "fact_rows" }> | null {
  const seen = new Set<string>();
  const rows: { id: string; label: string; value: string; asOf?: string }[] = [];
  let title: string | undefined;
  let sourceUrl: string | undefined;
  for (const part of parts) {
    if (!title && part.title) title = part.title;
    if (!sourceUrl && part.sourceUrl) sourceUrl = part.sourceUrl;
    for (const row of part.rows) {
      const key = `${row.asOf ?? ""}:${row.value}:${row.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
      if (rows.length >= UI_ITEMS_MAX) break;
    }
    if (rows.length >= UI_ITEMS_MAX) break;
  }
  if (!rows.length) return null;
  return {
    kind: "fact_rows",
    rows,
    ...(title ? { title } : {}),
    ...(sourceUrl ? { sourceUrl } : {})
  };
}

function mergeLedger(
  parts: Extract<UiPart, { kind: "ledger_figures" }>[]
): Extract<UiPart, { kind: "ledger_figures" }> | null {
  const byId = new Map<string, { id: string; title: string; value: number | null }>();
  for (const part of parts) {
    for (const item of part.items) {
      byId.set(item.id, item);
    }
  }
  const items = [...byId.values()].slice(0, UI_ITEMS_MAX);
  return items.length ? { kind: "ledger_figures", items } : null;
}

function mergeKanban(
  parts: Extract<UiPart, { kind: "kanban_snip" }>[]
): Extract<UiPart, { kind: "kanban_snip" }> | null {
  const byId = new Map<string, { id: string; title: string; state: string }>();
  for (const part of parts) {
    for (const card of part.cards) {
      byId.set(card.id, card);
    }
  }
  const cards = [...byId.values()].slice(0, UI_ITEMS_MAX);
  return cards.length ? { kind: "kanban_snip", cards } : null;
}

function lastOfKind<K extends UiPart["kind"]>(
  parts: readonly UiPart[],
  kind: K
): Extract<UiPart, { kind: K }> | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part?.kind === kind) return part as Extract<UiPart, { kind: K }>;
  }
  return null;
}

/** 同一ターンで同時に出さないジョブ面（比較／手順／文案）。 */
export const EXCLUSIVE_PRESENT_KINDS = ["compare_table", "checklist", "draft_preview"] as const;

export type ExclusivePresentKind = (typeof EXCLUSIVE_PRESENT_KINDS)[number];

function isExclusivePresentKind(kind: string): kind is ExclusivePresentKind {
  return (EXCLUSIVE_PRESENT_KINDS as readonly string[]).includes(kind);
}

/**
 * 今の発話が明示したジョブ面だけ残すための軽い合図。
 * ルータ入口には使わず、誤って同居した present_* 面の刈り込みに限る。
 */
export function exclusivePresentKindsWanted(utterance: string): ExclusivePresentKind[] {
  const out: ExclusivePresentKind[] = [];
  if (/チェックリスト|手順を進める/.test(utterance)) out.push("checklist");
  if (/下書き|文案|連絡文/.test(utterance)) out.push("draft_preview");
  if (/比較して|比べて|比較表|並べて比べ/.test(utterance)) out.push("compare_table");
  return out;
}

/**
 * 非並列ターンでは present 系ジョブ面を高々1種にする。
 * 並列（delegate）や、発話が複数ジョブを明示したときは同居を許す。
 */
export function resolveExclusivePresentSurfaces(
  parts: readonly UiPart[],
  opts: { userText?: string; parallelJobs?: boolean } = {}
): UiPart[] {
  const exclusive = parts.filter((p) => isExclusivePresentKind(p.kind));
  if (exclusive.length <= 1) return [...parts];
  if (opts.parallelJobs) return [...parts];

  const wanted = exclusivePresentKindsWanted(opts.userText ?? "");
  if (wanted.length >= 2) {
    return parts.filter((p) => !isExclusivePresentKind(p.kind) || wanted.includes(p.kind));
  }
  if (wanted.length === 1) {
    const keep = wanted[0]!;
    return parts.filter((p) => !isExclusivePresentKind(p.kind) || p.kind === keep);
  }

  let lastKind: ExclusivePresentKind | null = null;
  for (let i = parts.length - 1; i >= 0; i--) {
    const kind = parts[i]?.kind;
    if (kind && isExclusivePresentKind(kind)) {
      lastKind = kind;
      break;
    }
  }
  if (!lastKind) return [...parts];
  return parts.filter((p) => !isExclusivePresentKind(p.kind) || p.kind === lastKind);
}

/** 同一ターンの UiPart を kind 単位でマージし、part 数を上限内にする。 */
export function mergeUiParts(parts: readonly UiPart[]): UiPart[] {
  const picks = parts.filter((p): p is Extract<UiPart, { kind: "picks" }> => p.kind === "picks");
  const sources = parts.filter((p): p is Extract<UiPart, { kind: "sources" }> => p.kind === "sources");
  const ledger = parts.filter(
    (p): p is Extract<UiPart, { kind: "ledger_figures" }> => p.kind === "ledger_figures"
  );
  const kanban = parts.filter(
    (p): p is Extract<UiPart, { kind: "kanban_snip" }> => p.kind === "kanban_snip"
  );
  const out: UiPart[] = [];
  const p = mergePicks(picks);
  if (p) out.push(p);
  const dashboard = lastOfKind(parts, "dashboard");
  if (dashboard) {
    // dashboard があれば単独 chart は落とす（複合面を優先）。
    out.push(clampDashboard(dashboard));
  } else {
    const compare = lastOfKind(parts, "compare_table");
    if (compare) out.push(compare);
    // chart は種類ごとに残す（line / bar / donut）。同一ターンの「見る」を1枚に潰さない。
    for (const chart of parts.filter((part): part is Extract<UiPart, { kind: "chart" }> => part.kind === "chart")) {
      out.push(chart);
    }
  }
  const place = lastOfKind(parts, "place_list");
  if (place) out.push(place);
  const map = lastOfKind(parts, "map_snip");
  if (map) out.push(map);
  const forms = lastOfKind(parts, "forms");
  if (forms) {
    out.push(clampForms(forms));
  } else {
    const form = lastOfKind(parts, "form_fields");
    if (form) out.push(form);
  }
  const progress = lastOfKind(parts, "job_progress");
  if (progress) out.push(progress);
  const factRows = parts.filter((p): p is Extract<UiPart, { kind: "fact_rows" }> => p.kind === "fact_rows");
  const f = mergeFactRows(factRows);
  if (f) out.push(f);
  const s = mergeSources(sources);
  if (s) out.push(s);
  const l = mergeLedger(ledger);
  if (l) out.push(l);
  const k = mergeKanban(kanban);
  if (k) out.push(k);
  const checklist = lastOfKind(parts, "checklist");
  if (checklist) out.push(checklist);
  const draft = lastOfKind(parts, "draft_preview");
  if (draft) out.push(draft);
  return out.slice(0, UI_PART_MAX);
}

export function placeSelectionText(item: PlaceItem): string {
  const km = item.distanceM >= 1000 ? `${(item.distanceM / 1000).toFixed(1)}km` : `${item.distanceM}m`;
  const coords =
    typeof item.lat === "number" && typeof item.lng === "number"
      ? ` lat=${item.lat} lng=${item.lng}`
      : "";
  const base = `「${item.title}」（${km}）を採用します。${coords}`.trim();
  return item.url ? `${base} ${item.url}` : base;
}

export function formatFormValue(field: FormField, value: FormValue | undefined): string {
  if (value === undefined) return "";
  if (field.type === "currency" && typeof value === "number") {
    return `¥${Math.round(value).toLocaleString("ja-JP")}`;
  }
  if (typeof value === "boolean") return value ? "はい" : "いいえ";
  if (Array.isArray(value)) return value.join(",");
  return String(value);
}

export function formCommitSummary(
  fields: FormField[],
  values: Record<string, FormValue>
): string {
  const bits = fields.map((f) => `${f.label}=${formatFormValue(f, values[f.id])}`);
  return `前提を更新します。${bits.join("、")}`;
}

const FORMS_SECTIONS_MAX = 4;
const FORMS_FIELDS_MAX = 12;
const FORMS_SECTION_FIELDS_MAX = 6;

function clampForms(part: Extract<UiPart, { kind: "forms" }>): Extract<UiPart, { kind: "forms" }> {
  const sections: FormsSection[] = [];
  let fieldCount = 0;
  for (const section of part.sections) {
    if (sections.length >= FORMS_SECTIONS_MAX) break;
    const fields: FormField[] = [];
    for (const field of section.fields) {
      if (fields.length >= FORMS_SECTION_FIELDS_MAX) break;
      if (fieldCount >= FORMS_FIELDS_MAX) break;
      fields.push(field);
      fieldCount += 1;
    }
    if (fields.length) sections.push({ ...section, span: section.span === 2 ? 2 : 1, fields });
  }
  return { ...part, sections };
}

/** 複数ツール結果をまとめて UiPart[] にする。 */
export function collectUiParts(
  calls: readonly { name: string; args?: unknown; result: unknown }[]
): UiPart[] {
  const collected: UiPart[] = [];
  for (const call of calls) {
    collected.push(...mapToolToUiParts(call.name, call.args, call.result));
  }
  return mergeUiParts(collected);
}

/** 選択確定時にユーザー発話へ載せる文言（パース禁止・そのまま送る）。 */
export function pickSelectionText(item: PickItem): string {
  return item.url
    ? `「${item.title}」を採用します。${item.url}`
    : `「${item.title}」を採用します。`;
}
