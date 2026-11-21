import { DAILY_TOKEN_CAP } from "./limits";

/** Asia/Tokyo の暦日 `YYYY-MM-DD`。Cron なしで日替わりするキー。 */
export function tokyoDay(nowMs = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(nowMs));
}

/**
 * 日次トークン上限。
 * - 未設定 / `off` / `unlimited` / `-1` → 無し（`null`）
 * - `0` 以上の数 → その値（試験で `0` は即上限）
 */
export function resolveDailyTokenCap(env: Readonly<Record<string, string | undefined>>): number | null {
  const raw = env["FUDO_DAILY_TOKEN_CAP"]?.trim();
  if (!raw) return null;
  const lowered = raw.toLowerCase();
  if (lowered === "off" || lowered === "unlimited" || lowered === "none") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DAILY_TOKEN_CAP;
  if (n < 0) return null;
  return Math.floor(n);
}

export function isDailyTokenCapReached(tokensToday: number, tokenCap: number | null | undefined): boolean {
  if (tokenCap == null) return false;
  return tokensToday >= tokenCap;
}

export function tokensFromChatUsage(usage?: {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
} | null): number {
  if (!usage) return 0;
  if (typeof usage.total_tokens === "number" && Number.isFinite(usage.total_tokens)) {
    return Math.max(0, Math.floor(usage.total_tokens));
  }
  const prompt = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const completion = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
  return Math.max(0, Math.floor(prompt + completion));
}

export function tokensFromResponsesUsage(usage?: {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
} | null): number {
  if (!usage) return 0;
  if (typeof usage.total_tokens === "number" && Number.isFinite(usage.total_tokens)) {
    return Math.max(0, Math.floor(usage.total_tokens));
  }
  const input = typeof usage.input_tokens === "number"
    ? usage.input_tokens
    : typeof usage.prompt_tokens === "number"
      ? usage.prompt_tokens
      : 0;
  const output = typeof usage.output_tokens === "number"
    ? usage.output_tokens
    : typeof usage.completion_tokens === "number"
      ? usage.completion_tokens
      : 0;
  return Math.max(0, Math.floor(input + output));
}
