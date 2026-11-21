import { DurableObject } from "cloudflare:workers";
import {
  createSession,
  dialogueFromSession,
  loadSession,
  type SessionBlob,
  type SpeakRunStatus,
  type SpeakStreamEvent
} from "session";

type DialogueBlob = ReturnType<typeof dialogueFromSession>;

/**
 * ユーザーあたり 1 基。対話・計画・メモ・undo・speak delivery log を SQLite に保持。
 * LLM 呼び出しは Worker 側。ここは begin/commit・log 保管のみ。
 */
export class SessionDO extends DurableObject {
  private ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS dialogue (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS turn (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          generation INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS speak_run (
          run_id TEXT PRIMARY KEY,
          thread_id TEXT,
          generation INTEGER NOT NULL,
          status TEXT NOT NULL,
          events TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS speak_active (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          run_id TEXT
        );
        INSERT OR IGNORE INTO turn (id, generation) VALUES (1, 0);
      `);
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/begin") {
      const row = this.ctx.storage.sql.exec<{ generation: number }>("SELECT generation FROM turn WHERE id = 1").one();
      const generation = (row?.generation ?? 0) + 1;
      this.ctx.storage.sql.exec("UPDATE turn SET generation = ? WHERE id = 1", generation);
      return Response.json({ generation });
    }
    if (request.method === "GET" && url.pathname === "/generation") {
      const row = this.ctx.storage.sql.exec<{ generation: number }>("SELECT generation FROM turn WHERE id = 1").one();
      return Response.json({ generation: row?.generation ?? 0 });
    }
    if (request.method === "GET" && url.pathname === "/dialogue") {
      return Response.json(this.readDialogue());
    }
    if (request.method === "PUT" && url.pathname === "/dialogue") {
      const body = (await request.json()) as DialogueBlob;
      this.ctx.storage.sql.exec(
        "INSERT INTO dialogue (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload",
        JSON.stringify(body)
      );
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/import") {
      const blob = (await request.json()) as SessionBlob;
      const existing = this.readDialogue();
      if (existing.threads.length > 0) return Response.json({ imported: false });
      const session = loadSession(blob);
      const dialogue = dialogueFromSession(session);
      this.ctx.storage.sql.exec(
        "INSERT INTO dialogue (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload",
        JSON.stringify(dialogue)
      );
      return Response.json({ imported: true });
    }
    if (request.method === "POST" && url.pathname === "/speak-run/start") {
      const body = (await request.json()) as {
        runId: string;
        threadId: string | null;
        generation: number;
      };
      const now = Date.now();
      this.ctx.storage.sql.exec(
        `INSERT INTO speak_run (run_id, thread_id, generation, status, events, updated_at)
         VALUES (?, ?, ?, 'running', '[]', ?)
         ON CONFLICT(run_id) DO UPDATE SET
           thread_id = excluded.thread_id,
           generation = excluded.generation,
           status = 'running',
           events = '[]',
           updated_at = excluded.updated_at`,
        body.runId,
        body.threadId,
        body.generation,
        now
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO speak_active (id, run_id) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET run_id = excluded.run_id",
        body.runId
      );
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/speak-run/append") {
      const body = (await request.json()) as { runId: string; event: SpeakStreamEvent };
      const row = this.ctx.storage.sql
        .exec<{ status: string; events: string }>(
          "SELECT status, events FROM speak_run WHERE run_id = ?",
          body.runId
        )
        .toArray()[0];
      if (!row || row.status !== "running") return Response.json({ ok: false });
      const events = JSON.parse(row.events) as SpeakStreamEvent[];
      events.push(body.event);
      this.ctx.storage.sql.exec(
        "UPDATE speak_run SET events = ?, updated_at = ? WHERE run_id = ?",
        JSON.stringify(events),
        Date.now(),
        body.runId
      );
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/speak-run/finish") {
      const body = (await request.json()) as {
        runId: string;
        status: Exclude<SpeakRunStatus, "running">;
      };
      this.ctx.storage.sql.exec(
        "UPDATE speak_run SET status = ?, updated_at = ? WHERE run_id = ?",
        body.status,
        Date.now(),
        body.runId
      );
      const active = this.ctx.storage.sql
        .exec<{ run_id: string | null }>("SELECT run_id FROM speak_active WHERE id = 1")
        .toArray()[0];
      if (active?.run_id === body.runId) {
        this.ctx.storage.sql.exec("UPDATE speak_active SET run_id = NULL WHERE id = 1");
      }
      return Response.json({ ok: true });
    }
    if (request.method === "GET" && url.pathname === "/speak-run/read") {
      const runId = url.searchParams.get("runId") ?? "";
      const after = Number(url.searchParams.get("after") ?? "0");
      const row = this.ctx.storage.sql
        .exec<{ status: string; events: string }>(
          "SELECT status, events FROM speak_run WHERE run_id = ?",
          runId
        )
        .toArray()[0];
      if (!row) return Response.json({ ok: false });
      const events = JSON.parse(row.events) as SpeakStreamEvent[];
      return Response.json({
        ok: true,
        status: row.status,
        events: events.slice(Number.isFinite(after) ? Math.max(0, after) : 0)
      });
    }
    if (request.method === "GET" && url.pathname === "/speak-run/active") {
      const active = this.ctx.storage.sql
        .exec<{ run_id: string | null }>("SELECT run_id FROM speak_active WHERE id = 1")
        .toArray()[0];
      if (!active?.run_id) return Response.json({ active: null });
      const row = this.ctx.storage.sql
        .exec<{ thread_id: string | null; status: string }>(
          "SELECT thread_id, status FROM speak_run WHERE run_id = ?",
          active.run_id
        )
        .toArray()[0];
      if (!row || row.status !== "running") return Response.json({ active: null });
      return Response.json({
        active: { runId: active.run_id, threadId: row.thread_id }
      });
    }
    return new Response("not found", { status: 404 });
  }

  private readDialogue(): DialogueBlob {
    const rows = this.ctx.storage.sql.exec<{ payload: string }>("SELECT payload FROM dialogue WHERE id = 1").toArray();
    if (rows.length === 0) return dialogueFromSession(createSession());
    return JSON.parse(rows[0]!.payload) as DialogueBlob;
  }
}
