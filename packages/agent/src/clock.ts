// 定期実行の正本は nextFireAt（UTC）。rule は人が選ぶ周期。cron と 1 時間未満は受けない。
export type Schedule =
  | { kind: "daily"; hour: number; minute: number; nextFireAt: number }
  | { kind: "weekly"; weekday: number; hour: number; minute: number; nextFireAt: number }
  | { kind: "monthly"; date: number; hour: number; minute: number; nextFireAt: number }
  | { kind: "interval"; everyHours: number; nextFireAt: number };

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type ScheduleResult =
  | { ok: true; schedule: Schedule }
  | { ok: false; reason: "invalid_value"; detail: { constraint: string } };

export function saveSchedule(raw: unknown, nowMs = Date.now()): ScheduleResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "invalid_value", detail: { constraint: "毎日、曜日、日付、間隔のいずれか" } };
  }
  if ("cron" in raw) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "cron は使えない" } };
  }
  if ("interval" in raw && typeof (raw as { interval: unknown }).interval === "string") {
    return { ok: false, reason: "invalid_value", detail: { constraint: "間隔は everyHours（1以上の整数）" } };
  }
  const kind = "kind" in raw ? raw.kind : undefined;
  const existingNext =
    "nextFireAt" in raw && typeof raw.nextFireAt === "number" && Number.isFinite(raw.nextFireAt)
      ? Math.floor(raw.nextFireAt)
      : null;

  if (kind === "interval") {
    const everyHours = "everyHours" in raw ? raw.everyHours : undefined;
    if (typeof everyHours !== "number" || !Number.isInteger(everyHours) || everyHours < 1) {
      return { ok: false, reason: "invalid_value", detail: { constraint: "間隔は1時間以上の整数" } };
    }
    const nextFireAt = existingNext !== null && existingNext > nowMs
      ? existingNext
      : nowMs + everyHours * HOUR_MS;
    return { ok: true, schedule: { kind: "interval", everyHours, nextFireAt } };
  }

  const time = readTime(raw);
  if (!time.ok) return time;

  if (kind === "daily") {
    const rule = { kind: "daily" as const, hour: time.hour, minute: time.minute };
    return {
      ok: true,
      schedule: {
        ...rule,
        nextFireAt: existingNext !== null && existingNext > nowMs ? existingNext : nextCalendarFire(rule, nowMs)
      }
    };
  }
  if (kind === "weekly") {
    const weekday = "weekday" in raw ? raw.weekday : undefined;
    if (typeof weekday !== "number" || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return { ok: false, reason: "invalid_value", detail: { constraint: "曜日は0から6" } };
    }
    const rule = { kind: "weekly" as const, weekday, hour: time.hour, minute: time.minute };
    return {
      ok: true,
      schedule: {
        ...rule,
        nextFireAt: existingNext !== null && existingNext > nowMs ? existingNext : nextCalendarFire(rule, nowMs)
      }
    };
  }
  if (kind === "monthly") {
    const date = "date" in raw ? raw.date : undefined;
    if (typeof date !== "number" || !Number.isInteger(date) || date < 1 || date > 31) {
      return { ok: false, reason: "invalid_value", detail: { constraint: "日付は1から31" } };
    }
    const rule = { kind: "monthly" as const, date, hour: time.hour, minute: time.minute };
    return {
      ok: true,
      schedule: {
        ...rule,
        nextFireAt: existingNext !== null && existingNext > nowMs ? existingNext : nextCalendarFire(rule, nowMs)
      }
    };
  }
  return { ok: false, reason: "invalid_value", detail: { constraint: "毎日、曜日、日付、間隔のいずれか" } };
}

/** due 判定。正本は nextFireAt。 */
export function isDue(schedule: Schedule, nowMs: number): boolean {
  return nowMs >= schedule.nextFireAt;
}

/** @deprecated isDue を使う。旧テスト互換。 */
export function matchesSchedule(schedule: Schedule, nowMs: number): boolean {
  return isDue(schedule, nowMs);
}

/** 発火後の次枠。時計が大きく進んでも1段だけ進める（追いつき連打しない）。 */
export function advanceSchedule(schedule: Schedule, nowMs: number): Schedule {
  if (schedule.kind === "interval") {
    return { ...schedule, nextFireAt: nowMs + schedule.everyHours * HOUR_MS };
  }
  return { ...schedule, nextFireAt: nextCalendarFire(schedule, nowMs) };
}

/** その月に無い日は、月末の指定時刻（日本時間）を UTC で返す。 */
export function monthlyFireUtc(year: number, month: number, date: number, hour = 9, minute = 0): number {
  const day = Math.min(date, lastDay(year, month));
  return jstWallToUtc(year, month, day, hour, minute);
}

function readTime(raw: object): { ok: true; hour: number; minute: number } | Extract<ScheduleResult, { ok: false }> {
  const hasHour = "hour" in raw;
  const hasMinute = "minute" in raw;
  const hour = hasHour ? (raw as { hour: unknown }).hour : 9;
  const minute = hasMinute ? (raw as { minute: unknown }).minute : 0;
  if (typeof hour !== "number" || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "時は0から23" } };
  }
  if (typeof minute !== "number" || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "分は0から59" } };
  }
  return { ok: true, hour, minute };
}

type CalendarRule =
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekday: number; hour: number; minute: number }
  | { kind: "monthly"; date: number; hour: number; minute: number };

function nextCalendarFire(rule: CalendarRule, afterMs: number): number {
  const start = afterMs + 1000;
  for (let dayOffset = 0; dayOffset < 400; dayOffset += 1) {
    const probe = start + dayOffset * 24 * HOUR_MS;
    const jst = jstParts(probe);
    const day = rule.kind === "monthly" ? Math.min(rule.date, lastDay(jst.year, jst.month)) : jst.day;
    if (rule.kind === "weekly" && jst.weekday !== rule.weekday) continue;
    if (rule.kind === "monthly" && jst.day !== day) continue;
    const at = jstWallToUtc(jst.year, jst.month, day, rule.hour, rule.minute);
    if (at > afterMs) return at;
  }
  // 到達しない想定。安全策。
  return afterMs + 24 * HOUR_MS;
}

function jstWallToUtc(year: number, month: number, day: number, hour: number, minute: number): number {
  return Date.UTC(year, month - 1, day, hour, minute, 0) - JST_OFFSET_MS;
}

function jstParts(nowMs: number): { year: number; month: number; day: number; weekday: number; hours: number; minutes: number; seconds: number } {
  const jst = new Date(nowMs + JST_OFFSET_MS);
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
    day: jst.getUTCDate(),
    weekday: jst.getUTCDay(),
    hours: jst.getUTCHours(),
    minutes: jst.getUTCMinutes(),
    seconds: jst.getUTCSeconds()
  };
}

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
