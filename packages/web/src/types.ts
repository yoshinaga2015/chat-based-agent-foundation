export interface ThreadActivity {
  id: string;
  name: string;
  kind: string;
  label: string;
  target?: string;
  status: "running" | "ok" | "fail";
  ok: boolean;
  summary: string;
  preview?: { mime: "image/jpeg"; base64: string };
  quote?: string;
}

export type MediaImage = {
  url: string;
  alt?: string;
  role?: "hero" | "detail" | "context";
};

/**
 * Controlled chartType。
 * ECharts 基本系列 ＋ 投資／統計で頻出の派生。geo map / TimeseriesChart は対象外。
 */
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

export type ChartSeries = {
  name: string;
  data: number[];
  errors?: number[];
  ciLow?: number[];
  ciHigh?: number[];
};

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
  series: ChartSeries[];
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

/** 出典・鮮度・面の読者（任意）。 */
export type UiPartMeta = {
  producedAt?: number;
  sourceTool?: string;
  /** 省略時は kind 既定。internal はチャット非表示。 */
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
      /** @deprecated 本番は forms。旧メッセージ用。 */
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
        cardId?: string;
      }[];
    }
  | {
      kind: "draft_preview";
      title?: string;
      body: string;
    };

export type UiPart = UiPartBody & UiPartMeta;

export type PickItem = Extract<UiPart, { kind: "picks" }>["items"][number];
export type PlaceItem = Extract<UiPart, { kind: "place_list" }>["items"][number];

export type Pane = "chat" | "kanban" | "ability";

export interface ThreadLine {
  role: "user" | "assistant";
  text: string;
  attachments?: { name: string; media: string }[];
  activities?: ThreadActivity[];
  /** Generative UI Phase 1。 */
  ui?: UiPart[];
  /** この応答を出した対話モデル。 */
  model?: string;
}

export interface ChatModelChoice {
  id: string;
  label: string;
  images: boolean;
  billing: "free_allocation" | "gateway";
}

export interface PendingBrowserHandoff {
  reason: string;
  /** ユーザーが画面でやる具体。欠落時は UI が reason から補う。 */
  task?: string;
  liveViewUrl: string;
  createdAt: number;
  /** 期限。過ぎたら失敗相当で閉じる。 */
  expiresAt: number;
  /** リモート共有無し。手元操作はエージェントに戻らない。 */
  localOnly?: boolean;
}

export interface CardView {
  id: string;
  title: string;
  state: string;
  due: string | null;
  body: string;
  refs: string[];
}

export interface SkillView {
  name: string;
  description: string;
  body: string;
  material: "utterance" | "memo";
}

export interface WorkflowView {
  id: string;
  name: string;
  enabled: boolean;
  schedule: unknown;
  steps: string[];
}

export interface NoteView {
  id: string;
  title: string;
  body: string;
  value: number | null;
}

export interface MemoView {
  id: string;
  body: string;
  version: number;
}

export interface LastTurn {
  text: string;
  unconfirmed: { value: number }[];
  codeMarks: number[];
  operation: { ok: boolean; reason: string; detail?: unknown };
  blocked: boolean;
}

export interface ActiveSpeak {
  runId: string;
  threadId: string | null;
}

export interface ProductView {
  home: boolean;
  notice: string | null;
  /** 能力ペイン専用。スレッドには出さない。 */
  abilityNotice: string | null;
  tokensToday: number;
  tokenCap: number | null;
  tokenCapReached: boolean;
  tokenCapMessage: string;
  threads: { id: string; title: string; awaiting?: "approval" | "handoff" | null }[];
  activeThreadId: string | null;
  /** 今のスレッドで使う対話モデル。 */
  model: string;
  modelChoices: ChatModelChoice[];
  /** 進行中の detached speak。リロード復帰用。 */
  activeSpeak?: ActiveSpeak | null;
  /** 書類の置き場（R2）がある配備だけ true。 */
  documentsEnabled?: boolean;
  /** 設定が足りずに使えない能力。値は出さず、足りない名前だけ。 */
  capabilityGaps?: { id: string; label: string; missing: string[] }[];
  lines: ThreadLine[];
  cards: CardView[];
  skills: SkillView[];
  workflows: WorkflowView[];
  posts: string[];
  ran: string[];
  last: LastTurn | null;
  planPending: boolean;
  pendingPlan: string | null;
  pendingDelete: { kind: string; id: string } | null;
  pendingMcp: { op: string; id?: string; server?: { id: string; name: string; url: string } } | null;
  pendingAgentWrite: {
    runId: string;
    agent: string;
    workspace: { kind: "files"; docIds: string[] } | { kind: "repo"; repo: string; ref?: string };
    changes: { path: string; status: "added" | "modified" | "deleted"; binary: boolean; diff?: string; bytes?: number }[];
    result: string;
    label: string;
  } | null;
  pendingBrowserHandoff: PendingBrowserHandoff | null;
  agentCatalog?: { id: string; name: string }[];
  agentAllow?: string[];
  mcpServers: {
    id: string;
    name: string;
    url: string;
    auth: "none" | "bearer" | "oauth";
    hasSecret: boolean;
    catalogId?: string;
    needsReauth?: boolean;
    lastProbe?: { ok: boolean; detail: string; at: number; tools?: string[] };
    listedTools?: string[];
  }[];
  mcpCatalog: {
    id: string;
    name: string;
    url: string;
    auth: ("none" | "bearer" | "oauth")[];
    bearer?: { label: string; where: string; createUrl?: string; placeholder?: string };
  }[];
  mcpUserHosts: string[];
  mcpHostAllow: string[];
  cliAllow: string[];
  notes: NoteView[];
  memos: MemoView[];
  jobs: string[];
}

export const CARD_STATES = ["未着手", "実行中", "確認待ち", "完了"] as const;
