/**
 * 殻とドメインの境界。殻はドメインのパッケージを import せず、配備の合成ルートが
 * installDomainPack で1つだけ差し込む。差し込まれなければ空のパックで動く。
 */
import type { ToolProgress } from "./activity";
import type { Desk } from "./desk";
import type { UiPart } from "./uiParts";

export type DomainCalc = (input: unknown) => unknown;

export interface DomainRecordOp {
  kind: string;
  id: string;
  fields: Record<string, unknown>;
}

export type DomainCommit =
  | { ok: true; state: unknown }
  | { ok: false; reason: "invalid_value" | "record_not_found" | "field_unknown" | "plan_pending"; detail: unknown };

/** 保存は2つに分かれる。dialogue は対話と同じ場所、files は資料の表。 */
export interface DomainStored {
  dialogue: unknown;
  files: unknown[];
}

/** 発話を LLM の前で決定的に処理した結果。session が利用者の行と応答の行をスレッドへ書く。 */
export interface DomainReply {
  desk: Desk;
  answer: string;
  task: string;
  activities?: ToolProgress[];
  ui?: UiPart[];
}

/** 経路が足す応答の行。 */
export interface DomainLine {
  text: string;
  activities?: ToolProgress[];
  ui?: UiPart[];
}

export interface DomainAttachment {
  bytes: Uint8Array;
  media: string;
  name: string;
}

export interface DomainRouteRequest {
  method: string;
  path: string;
  headers: (name: string) => string | null;
  query: (name: string) => string | null;
  json: () => Promise<Record<string, unknown>>;
  bytes: (limit: number) => Promise<Uint8Array>;
}

export type DomainRouteResult =
  | { kind: "desk"; desk: Desk; lines?: DomainLine[]; extra?: Record<string, unknown> }
  | { kind: "file"; bytes: Uint8Array; contentType: string; filename: string }
  | { kind: "error"; status: number; reason: string };

export interface DomainRoute {
  method: "GET" | "POST";
  path: string;
  handle: (request: DomainRouteRequest, desk: Desk, now: number) => Promise<DomainRouteResult> | DomainRouteResult;
}

export interface DomainPack {
  id: string;
  empty(): unknown;
  dump(state: unknown): DomainStored;
  /** raw は保存済みの全体。旧形式（パック導入前）の読み替えに使う。 */
  load(stored: Partial<DomainStored>, raw: unknown): unknown;
  calcNames: readonly string[];
  calcs(state: unknown): Map<string, DomainCalc>;
  /** write_records の追加 kind。 */
  records?: {
    kinds: readonly string[];
    commit(state: unknown, ops: readonly DomainRecordOp[], planPending: boolean): DomainCommit;
  };
  compareRows?(state: unknown): unknown;
  /** run_calc の結果を画面の部品へ。 */
  mapCalcResult?(result: unknown): UiPart[];
  /** システムプロンプトの末尾に足す行。 */
  prompt?: readonly string[];
  /** 道具の説明の末尾に足す文。 */
  toolNotes?: Readonly<Record<string, string>>;
  intercept?(input: { desk: Desk; utterance: string; now: number }): DomainReply | null;
  attach?(desk: Desk, attachment: DomainAttachment, now: number): Desk;
  view?(desk: Desk): Record<string, unknown>;
  routes?: readonly DomainRoute[];
}

export const EMPTY_DOMAIN_PACK: DomainPack = {
  id: "none",
  empty: () => null,
  dump: () => ({ dialogue: null, files: [] }),
  load: () => null,
  calcNames: [],
  calcs: () => new Map()
};

let installed: DomainPack = EMPTY_DOMAIN_PACK;

export function installDomainPack(pack: DomainPack): void {
  installed = pack;
}

export function resetDomainPack(): void {
  installed = EMPTY_DOMAIN_PACK;
}

export function domainPack(): DomainPack {
  return installed;
}

export function domainRoute(method: string, path: string): DomainRoute | null {
  return installed.routes?.find((route) => route.method === method && route.path === path) ?? null;
}
