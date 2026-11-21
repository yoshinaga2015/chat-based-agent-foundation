import { tokyoDay } from "agent";

const USAGE_TABLE = `CREATE TABLE IF NOT EXISTS llm_usage (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER,
  tag TEXT,
  PRIMARY KEY (user_id, day)
)`;

let usageReady: Promise<void> | null = null;

export function ensureUsageSchema(db: D1Database): Promise<void> {
  if (!usageReady) {
    usageReady = db.prepare(USAGE_TABLE).run().then(() => undefined);
  }
  return usageReady;
}

export async function loadTokensToday(db: D1Database, userId: string, nowMs = Date.now()): Promise<number> {
  await ensureUsageSchema(db);
  const day = tokyoDay(nowMs);
  const row = await db
    .prepare("SELECT tokens FROM llm_usage WHERE user_id = ? AND day = ?")
    .bind(userId, day)
    .first<{ tokens: number }>();
  return typeof row?.tokens === "number" ? row.tokens : 0;
}

/** 原子加算。行が無ければ INSERT。 */
export async function addTokens(
  db: D1Database,
  userId: string,
  delta: number,
  nowMs = Date.now()
): Promise<number> {
  if (!Number.isFinite(delta) || delta <= 0) return loadTokensToday(db, userId, nowMs);
  await ensureUsageSchema(db);
  const day = tokyoDay(nowMs);
  const updatedAt = nowMs;
  await db
    .prepare(
      `INSERT INTO llm_usage (user_id, day, tokens, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, day) DO UPDATE SET
         tokens = tokens + excluded.tokens,
         updated_at = excluded.updated_at`
    )
    .bind(userId, day, Math.floor(delta), updatedAt)
    .run();
  return loadTokensToday(db, userId, nowMs);
}
