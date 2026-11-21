/** ブラウザ操作セッション（B2）。読むだけは browser_fetch。 */

import { assertBrowserUrl, browserHostAllowFromEnv } from "./browser";
import type { BrowserScreenshot } from "./browserScreenshot";

export const BROWSER_ACT_PER_TURN = 10;
export const BROWSER_SNAPSHOT_CHARS = 10_000;

/** local Chromium の操作面。Steel Live View の代わりに handoff を成立させる。 */
export const LOCAL_HANDOFF_SURFACE = "fudo-local://browser";

/**
 * Browser Run で Live View URL が取れないとき（ローカル binding 等）の handoff 面。
 * HTTP の Live View は無いが、Banner（完了／やめる）は出せる。
 */
export const BROWSER_RUN_HANDOFF_SURFACE = "fudo-browser-run://session";

export function isLocalHandoffSurface(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith("fudo-local:");
}

/** iframe／別タブで開けない handoff 面（local Chromium / Browser Run フォールバック）。 */
export function isEmbeddedHandoffSurface(url: string | null | undefined): boolean {
  return (
    typeof url === "string" &&
    (url.startsWith("fudo-local:") || url.startsWith("fudo-browser-run:"))
  );
}

export type BrowserSessionSnapshot = {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
};

export type { BrowserScreenshot } from "./browserScreenshot";

export type BrowserScrollDirection = "up" | "down";

export type BrowserScrollTarget = {
  direction: BrowserScrollDirection;
  /** ピクセル。省略時 600。 */
  amount?: number;
  /** 指定時はその要素をスクロール。無ければ window。 */
  selector?: string;
};

export type BrowserSelectTarget = {
  selector: string;
  value?: string;
  label?: string;
};

export type BrowserSession = {
  navigate(url: string): Promise<BrowserSessionSnapshot>;
  snapshot(): Promise<BrowserSessionSnapshot>;
  click(target: BrowserClickTarget): Promise<{ url: string; title: string }>;
  type(selector: string, text: string, submit?: boolean): Promise<{ url: string; title: string }>;
  scroll(target: BrowserScrollTarget): Promise<{ url: string; title: string }>;
  select(target: BrowserSelectTarget): Promise<{ url: string; title: string }>;
  /** 活動プレビュー用。未 open / 失敗は null。 */
  screenshot(): Promise<BrowserScreenshot | null>;
  /** Steel／CF Live View。local と CF フォールバックは embedded surface URI。 */
  liveViewUrl(): string | null;
  /** handoff 直前に Live View を取り直す（HTTP クライアントのキャッシュ抜け用）。 */
  refreshLiveViewUrl(): Promise<string | null>;
  /**
   * ユーザー操作に渡すため CDP／Playwright 接続だけ切る。
   * Steel セッションと Live View URL は残す（接続が残ると Live View でキー入力できない）。
   */
  detachForHandoff(): Promise<void>;
  /**
   * フォーカス中の要素へ確定済み文字列を挿入（IME 相当）。
   * Steel Live View は composition を扱えないため、handoff 中の日本語入力に使う。
   */
  insertText(text: string): Promise<void>;
  close(): Promise<void>;
};

export type HandoffReason = "login" | "captcha" | "blocked" | "other";

export type PendingBrowserHandoff = {
  reason: HandoffReason;
  /** ユーザーが画面でやる具体。空なら handoff 自体を拒否する。 */
  task: string;
  liveViewUrl: string;
  createdAt: number;
  /** 期限。過ぎたら Failed 相当で閉じる（CF / BrowserHub 同型）。 */
  expiresAt: number;
  /**
   * リモートに共有セッションが無い（到達不能＋手元ブラウザ案内）。
   * 完了後もユーザー画面はエージェントに戻らない。報告はチャット。
   */
  localOnly?: boolean;
};

/** reason 別 TTL（Browser Run の「タスク複雑度に合わせる」に寄せる）。 */
export const HANDOFF_TTL_MS: Record<HandoffReason, number> = {
  login: 15 * 60_000,
  captcha: 5 * 60_000,
  blocked: 5 * 60_000,
  other: 10 * 60_000
};

export function handoffExpiresAt(reason: HandoffReason, createdAt: number): number {
  return createdAt + HANDOFF_TTL_MS[reason];
}

export function isHandoffExpired(
  handoff: Pick<PendingBrowserHandoff, "reason" | "createdAt" | "expiresAt">,
  now: number
): boolean {
  const expiresAt = handoff.expiresAt || handoffExpiresAt(handoff.reason, handoff.createdAt);
  return now >= expiresAt;
}

export type BrowserHandoffOutcome =
  | { ok: true; result: PendingBrowserHandoff }
  | {
      ok: false;
      reason: "unavailable" | "not_open" | "no_live_view" | "invalid_value";
      detail?: { constraint?: string };
    };

const TASK_MIN = 8;
const TASK_MAX = 200;

export function normalizeHandoffReason(raw: unknown): HandoffReason {
  return raw === "login" || raw === "captcha" || raw === "blocked" || raw === "other" ? raw : "other";
}

export function normalizeHandoffTask(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < TASK_MIN || text.length > TASK_MAX) return null;
  return text;
}

/** UI／フォールバック発話用。旧データで task が空でも reason から短く補う。 */
export function handoffTaskText(handoff: Pick<PendingBrowserHandoff, "reason" | "task">): string {
  const task = handoff.task?.trim();
  if (task) return task;
  if (handoff.reason === "login") return "ログインを済ませ、目的の画面が見えたら完了かやめるを押す。";
  if (handoff.reason === "captcha") return "認証や画像確認を済ませたら完了かやめるを押す。";
  if (handoff.reason === "blocked") return "アクセス確認を通したら完了かやめるを押す。";
  return "画面で必要な操作を済ませたら完了かやめるを押す。";
}

/** Banner が task を出すので、同じ文の吹き出しは出さない。 */
export function isHandoffTaskEcho(spoken: string, task: string): boolean {
  const a = spoken.replace(/\s+/g, "").trim();
  const b = task.replace(/\s+/g, "").trim();
  if (!a) return true;
  if (!b) return false;
  if (a === b) return true;
  if (b.length >= 16 && a.includes(b)) return true;
  if (a.length >= 16 && b.includes(a) && a.length >= b.length * 0.7) return true;
  return false;
}

export type BrowserHandoffOptions = {
  /** @deprecated 共有セッションが無い handoff は出さない。到達不能は本文で案内する。 */
  allowUnopened?: boolean;
};

/** 共有 Live View／操作面が無く、handoff カードにならない面。 */
export function isUnsharedHandoffSurface(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith("fudo-browser-run:");
}

export async function browserRequestHandoff(
  session: BrowserSession | undefined,
  opened: boolean,
  reasonRaw: unknown,
  taskRaw: unknown = undefined,
  now = Date.now(),
  _options: BrowserHandoffOptions = {}
): Promise<BrowserHandoffOutcome> {
  if (!session) {
    return { ok: false, reason: "unavailable", detail: { constraint: "ブラウザ操作が無効" } };
  }
  // 未 open＝共有画面が無い。偽の handoff Banner は出さない（到達不能は本文で案内）。
  if (!opened) {
    return {
      ok: false,
      reason: "not_open",
      detail: {
        constraint:
          "共有できるブラウザ画面が無い。handoff せず、URL と手順を本文で伝え数値はチャットで聞く"
      }
    };
  }
  const task = normalizeHandoffTask(taskRaw);
  if (!task) {
    return {
      ok: false,
      reason: "invalid_value",
      detail: {
        constraint: `task にユーザーがやる具体（${TASK_MIN}〜${TASK_MAX}字）が要る。例: ログインしてトップが見えたら完了を押す`
      }
    };
  }
  const reason = normalizeHandoffReason(reasonRaw);
  const refreshed = (await session.refreshLiveViewUrl().catch(() => null))?.trim() ?? "";
  const liveViewUrl = refreshed || session.liveViewUrl()?.trim() || "";
  if (!liveViewUrl || isUnsharedHandoffSurface(liveViewUrl)) {
    return {
      ok: false,
      reason: "no_live_view",
      detail: { constraint: "この実行環境では画面操作を渡せない（Steel Live View が必要）" }
    };
  }
  // CDP が残ったままだと Live View 側のキーボードが効かない
  await session.detachForHandoff().catch(() => undefined);
  return {
    ok: true,
    result: {
      reason,
      task,
      liveViewUrl,
      createdAt: now,
      expiresAt: handoffExpiresAt(reason, now)
    }
  };
}

/** name 優先。無ければ selector。 */
export type BrowserClickTarget = {
  name?: string;
  role?: string;
  selector?: string;
};

export type BrowserSessionOutcome =
  | {
      ok: true;
      result: BrowserSessionSnapshot | { url: string; title: string } | { closed: true };
      detail?: { backend?: "steel"; constraint?: string };
    }
  | {
      ok: false;
      reason:
        | "limit"
        | "invalid_url"
        | "host_denied"
        | "private_host"
        | "unavailable"
        | "not_open"
        | "invalid_value"
        | "act_error";
      detail?: { constraint?: string; unreachable?: boolean; backend?: "steel" };
    };

/** navigate 失敗が「出口から届かない」系か（即 handoff 誘導用）。 */
export function isBrowserUnreachableConstraint(constraint: string | undefined): boolean {
  if (!constraint) return false;
  return /timeout|timed?\s*out|522|ERR_CONNECTION|ERR_ABORTED|ERR_NAME_NOT_RESOLVED|ERR_TUNNEL|net::ERR_/i.test(
    constraint
  );
}

export function browserBackendFromEnv(
  env: Readonly<Record<string, string | undefined>> = {}
): "local" | "steel" | "cf" | "off" {
  const raw = (env["FUDO_BROWSER_BACKEND"] ?? "local").trim().toLowerCase();
  if (raw === "off" || raw === "none" || raw === "false" || raw === "0") return "off";
  if (raw === "steel") return "steel";
  if (raw === "cf" || raw === "browser-run" || raw === "browserrun") return "cf";
  if (raw === "local") return "local";
  if (raw === "" || raw === "auto") {
    // Node sidecar: Steel キーがあれば steel、無ければ local。
    // Workers 本番の cf 優先は api の workerBrowserMode が担当。
    if (env["STEEL_API_KEY"]?.trim()) return "steel";
    return "local";
  }
  return "off";
}

export async function browserNavigate(
  acts: number,
  session: BrowserSession | undefined,
  rawUrl: string,
  allowHosts: readonly string[] = []
): Promise<BrowserSessionOutcome> {
  if (acts >= BROWSER_ACT_PER_TURN) return { ok: false, reason: "limit" };
  if (!session) {
    return {
      ok: false,
      reason: "unavailable",
      detail: { constraint: "ブラウザ操作が無効。FUDO_BROWSER_BACKEND=local と Playwright が要る" }
    };
  }
  const checked = assertBrowserUrl(rawUrl, allowHosts);
  if (!checked.ok) return { ok: false, reason: checked.reason };
  try {
    const result = await session.navigate(checked.url.toString());
    const denied = await denyIfUrlLeftAllowlist(session, result.url, allowHosts);
    if (denied) return denied;
    const backend = readSessionBackend(result);
    return {
      ok: true,
      result: truncateSnapshot(stripSessionBackend(result)),
      ...(backend ? { detail: { backend } } : {})
    };
  } catch (error) {
    const constraint = error instanceof Error ? error.message.slice(0, 200) : "navigate_failed";
    return {
      ok: false,
      reason: "act_error",
      detail: {
        constraint,
        ...(isBrowserUnreachableConstraint(constraint) ? { unreachable: true } : {})
      }
    };
  }
}

export async function browserSnapshot(
  acts: number,
  session: BrowserSession | undefined,
  opened: boolean,
  allowHosts: readonly string[] = []
): Promise<BrowserSessionOutcome> {
  if (acts >= BROWSER_ACT_PER_TURN) return { ok: false, reason: "limit" };
  if (!session) {
    return {
      ok: false,
      reason: "unavailable",
      detail: { constraint: "ブラウザ操作が無効" }
    };
  }
  if (!opened) return { ok: false, reason: "not_open", detail: { constraint: "先に browser_navigate" } };
  try {
    const result = await session.snapshot();
    const denied = await denyIfUrlLeftAllowlist(session, result.url, allowHosts);
    if (denied) return denied;
    return { ok: true, result: truncateSnapshot(result) };
  } catch (error) {
    return {
      ok: false,
      reason: "act_error",
      detail: { constraint: error instanceof Error ? error.message.slice(0, 200) : "snapshot_failed" }
    };
  }
}

export async function browserClick(
  acts: number,
  session: BrowserSession | undefined,
  opened: boolean,
  target: BrowserClickTarget | string,
  allowHosts: readonly string[] = []
): Promise<BrowserSessionOutcome> {
  if (acts >= BROWSER_ACT_PER_TURN) return { ok: false, reason: "limit" };
  if (!session) return { ok: false, reason: "unavailable", detail: { constraint: "ブラウザ操作が無効" } };
  if (!opened) return { ok: false, reason: "not_open", detail: { constraint: "先に browser_navigate" } };
  const normalized = normalizeClickTarget(target);
  if (!normalized.name && !normalized.selector) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "name か selector が要る" } };
  }
  try {
    const result = await session.click(normalized);
    const denied = await denyIfUrlLeftAllowlist(session, result.url, allowHosts);
    if (denied) return denied;
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      reason: "act_error",
      detail: { constraint: error instanceof Error ? error.message.slice(0, 200) : "click_failed" }
    };
  }
}

export function normalizeClickTarget(target: BrowserClickTarget | string): BrowserClickTarget {
  if (typeof target === "string") return { selector: target.trim() };
  return {
    name: target.name?.trim() || undefined,
    role: target.role?.trim() || undefined,
    selector: target.selector?.trim() || undefined
  };
}

export async function browserType(
  acts: number,
  session: BrowserSession | undefined,
  opened: boolean,
  selector: string,
  text: string,
  submit = false,
  allowHosts: readonly string[] = []
): Promise<BrowserSessionOutcome> {
  if (acts >= BROWSER_ACT_PER_TURN) return { ok: false, reason: "limit" };
  if (!session) return { ok: false, reason: "unavailable", detail: { constraint: "ブラウザ操作が無効" } };
  if (!opened) return { ok: false, reason: "not_open", detail: { constraint: "先に browser_navigate" } };
  if (!selector.trim()) return { ok: false, reason: "invalid_value", detail: { constraint: "selector が要る" } };
  try {
    const result = await session.type(selector.trim(), text, submit);
    const denied = await denyIfUrlLeftAllowlist(session, result.url, allowHosts);
    if (denied) return denied;
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      reason: "act_error",
      detail: { constraint: error instanceof Error ? error.message.slice(0, 200) : "type_failed" }
    };
  }
}

export async function browserScroll(
  acts: number,
  session: BrowserSession | undefined,
  opened: boolean,
  target: BrowserScrollTarget,
  allowHosts: readonly string[] = []
): Promise<BrowserSessionOutcome> {
  if (acts >= BROWSER_ACT_PER_TURN) return { ok: false, reason: "limit" };
  if (!session) return { ok: false, reason: "unavailable", detail: { constraint: "ブラウザ操作が無効" } };
  if (!opened) return { ok: false, reason: "not_open", detail: { constraint: "先に browser_navigate" } };
  if (target.direction !== "up" && target.direction !== "down") {
    return { ok: false, reason: "invalid_value", detail: { constraint: "direction は up か down" } };
  }
  try {
    const result = await session.scroll({
      direction: target.direction,
      amount: typeof target.amount === "number" && target.amount > 0 ? Math.min(target.amount, 4000) : undefined,
      selector: target.selector?.trim() || undefined
    });
    const denied = await denyIfUrlLeftAllowlist(session, result.url, allowHosts);
    if (denied) return denied;
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      reason: "act_error",
      detail: { constraint: error instanceof Error ? error.message.slice(0, 200) : "scroll_failed" }
    };
  }
}

export async function browserSelect(
  acts: number,
  session: BrowserSession | undefined,
  opened: boolean,
  target: BrowserSelectTarget,
  allowHosts: readonly string[] = []
): Promise<BrowserSessionOutcome> {
  if (acts >= BROWSER_ACT_PER_TURN) return { ok: false, reason: "limit" };
  if (!session) return { ok: false, reason: "unavailable", detail: { constraint: "ブラウザ操作が無効" } };
  if (!opened) return { ok: false, reason: "not_open", detail: { constraint: "先に browser_navigate" } };
  const selector = target.selector?.trim() ?? "";
  const value = target.value?.trim() ?? "";
  const label = target.label?.trim() ?? "";
  if (!selector) return { ok: false, reason: "invalid_value", detail: { constraint: "selector が要る" } };
  if (!value && !label) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "value か label が要る" } };
  }
  try {
    const result = await session.select({ selector, value: value || undefined, label: label || undefined });
    const denied = await denyIfUrlLeftAllowlist(session, result.url, allowHosts);
    if (denied) return denied;
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      reason: "act_error",
      detail: { constraint: error instanceof Error ? error.message.slice(0, 200) : "select_failed" }
    };
  }
}

type BackendTagged = { backend?: unknown };

function readSessionBackend(result: BrowserSessionSnapshot & BackendTagged): "steel" | undefined {
  return result.backend === "steel" ? "steel" : undefined;
}

function stripSessionBackend(result: BrowserSessionSnapshot & BackendTagged): BrowserSessionSnapshot {
  if (!("backend" in result)) return result;
  const { backend: _drop, ...rest } = result;
  return rest;
}

async function denyIfUrlLeftAllowlist(
  session: BrowserSession,
  url: string,
  allowHosts: readonly string[]
): Promise<BrowserSessionOutcome | null> {
  const checked = assertBrowserUrl(url, allowHosts);
  if (checked.ok) return null;
  await session.close().catch(() => undefined);
  return {
    ok: false,
    reason: checked.reason,
    detail: { constraint: `url_left_allowlist:${url.slice(0, 200)}` }
  };
}

export async function browserClose(session: BrowserSession | undefined): Promise<BrowserSessionOutcome> {
  if (!session) return { ok: true, result: { closed: true } };
  try {
    await session.close();
    return { ok: true, result: { closed: true } };
  } catch (error) {
    return {
      ok: false,
      reason: "act_error",
      detail: { constraint: error instanceof Error ? error.message.slice(0, 200) : "close_failed" }
    };
  }
}

export function truncateSnapshot(snap: BrowserSessionSnapshot): BrowserSessionSnapshot {
  if (snap.text.length <= BROWSER_SNAPSHOT_CHARS) return snap;
  return { ...snap, text: snap.text.slice(0, BROWSER_SNAPSHOT_CHARS), truncated: true };
}

export { browserHostAllowFromEnv };
