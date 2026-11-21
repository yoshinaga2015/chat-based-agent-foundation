import { describe, expect, it } from "vitest";
import { addTokens, loadTokensToday } from "./usage";

type Row = { tokens: number; updated_at: number | null };

/** 原子加算の挙動だけを検証する最小 D1 もどき。 */
function memoryDb(): D1Database {
  const store = new Map<string, Row>();
  const key = (userId: string, day: string) => `${userId}\0${day}`;

  const stmt = (sql: string) => {
    let bound: unknown[] = [];
    const api = {
      bind(...args: unknown[]) {
        bound = args;
        return api;
      },
      async first<T>(): Promise<T | null> {
        if (sql.includes("SELECT tokens")) {
          const [userId, day] = bound as [string, string];
          const row = store.get(key(userId, day));
          return (row ? { tokens: row.tokens } : null) as T | null;
        }
        return null;
      },
      async run(): Promise<D1Result> {
        if (sql.includes("CREATE TABLE")) return { success: true, meta: {} } as D1Result;
        if (sql.includes("INSERT INTO llm_usage")) {
          const [userId, day, tokens, updatedAt] = bound as [string, string, number, number];
          const k = key(userId, day);
          const prev = store.get(k);
          store.set(k, {
            tokens: (prev?.tokens ?? 0) + tokens,
            updated_at: updatedAt
          });
        }
        return { success: true, meta: {} } as D1Result;
      }
    };
    return api;
  };

  return { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}

describe("D1 llm_usage", () => {
  it("無い日は 0、原子加算で積み上がる", async () => {
    const db = memoryDb();
    expect(await loadTokensToday(db, "local", Date.parse("2026-10-22T12:00:00+09:00"))).toBe(0);
    expect(await addTokens(db, "local", 100, Date.parse("2026-10-22T12:00:00+09:00"))).toBe(100);
    expect(await addTokens(db, "local", 50, Date.parse("2026-10-22T18:00:00+09:00"))).toBe(150);
    expect(await loadTokensToday(db, "local", Date.parse("2026-10-22T20:00:00+09:00"))).toBe(150);
  });

  it("JST 日が変わると別枠", async () => {
    const db = memoryDb();
    await addTokens(db, "local", 10, Date.parse("2026-10-22T23:30:00+09:00"));
    expect(await loadTokensToday(db, "local", Date.parse("2026-10-23T00:30:00+09:00"))).toBe(0);
  });
});
