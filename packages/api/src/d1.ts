import type { Card, Note, UserSkill, Workflow } from "agent";
import type { Session, SessionBlob } from "session";
import { dumpSession, loadSession } from "session";

const TABLES = [
  `CREATE TABLE IF NOT EXISTS notes (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
)`,
  `CREATE TABLE IF NOT EXISTS cards (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
)`,
  `CREATE TABLE IF NOT EXISTS skills (
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (user_id, name)
)`,
  `CREATE TABLE IF NOT EXISTS workflows (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
)`,
  `CREATE TABLE IF NOT EXISTS ran (
  user_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (user_id, seq)
)`,
  `CREATE TABLE IF NOT EXISTS files (
  user_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (user_id, seq)
)`,
  `CREATE TABLE IF NOT EXISTS meta (
  user_id TEXT NOT NULL PRIMARY KEY,
  migrated INTEGER NOT NULL DEFAULT 0
)`,
  `CREATE TABLE IF NOT EXISTS llm_usage (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER,
  tag TEXT,
  PRIMARY KEY (user_id, day)
)`
];

let schemaReady: Promise<void> | null = null;

export function ensureD1Schema(db: D1Database): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const sql of TABLES) {
        await db.prepare(sql).run();
      }
    })();
  }
  return schemaReady;
}

export type LedgerSlice = Pick<SessionBlob, "notes" | "cards" | "skills" | "workflows" | "ran" | "files">;

export async function loadLedger(db: D1Database, userId: string): Promise<LedgerSlice> {
  await ensureD1Schema(db);
  const notesRows = await db.prepare("SELECT id, payload FROM notes WHERE user_id = ?").bind(userId).all<{ id: string; payload: string }>();
  const cardsRows = await db.prepare("SELECT id, payload FROM cards WHERE user_id = ?").bind(userId).all<{ id: string; payload: string }>();
  const skillsRows = await db.prepare("SELECT name, payload FROM skills WHERE user_id = ?").bind(userId).all<{ name: string; payload: string }>();
  const workflowRows = await db.prepare("SELECT id, payload FROM workflows WHERE user_id = ?").bind(userId).all<{ id: string; payload: string }>();
  const ranRows = await db.prepare("SELECT name FROM ran WHERE user_id = ? ORDER BY seq").bind(userId).all<{ name: string }>();
  const fileRows = await db.prepare("SELECT payload FROM files WHERE user_id = ? ORDER BY seq").bind(userId).all<{ payload: string }>();

  const notes: [string, Note][] = (notesRows.results ?? []).map((row) => [row.id, JSON.parse(row.payload) as Note]);
  const cards: [string, Card][] = (cardsRows.results ?? []).map((row) => [row.id, JSON.parse(row.payload) as Card]);
  const skills: Record<string, UserSkill> = {};
  for (const row of skillsRows.results ?? []) skills[row.name] = JSON.parse(row.payload) as UserSkill;
  const workflows = (workflowRows.results ?? []).map((row) => JSON.parse(row.payload) as Workflow);
  const ran = (ranRows.results ?? []).map((row) => row.name);
  const files = (fileRows.results ?? []).map((row) => JSON.parse(row.payload)) as SessionBlob["files"];
  return { notes, cards, skills, workflows, ran, files };
}

export async function saveLedger(db: D1Database, userId: string, session: Session): Promise<void> {
  await ensureD1Schema(db);
  const blob = dumpSession(session);
  const stmts: D1PreparedStatement[] = [
    db.prepare("DELETE FROM notes WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM cards WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM skills WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM workflows WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM ran WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM files WHERE user_id = ?").bind(userId)
  ];
  for (const [id, note] of blob.notes) {
    stmts.push(db.prepare("INSERT INTO notes (user_id, id, payload) VALUES (?, ?, ?)").bind(userId, id, JSON.stringify(note)));
  }
  for (const [id, card] of blob.cards) {
    stmts.push(db.prepare("INSERT INTO cards (user_id, id, payload) VALUES (?, ?, ?)").bind(userId, id, JSON.stringify(card)));
  }
  for (const [name, skill] of Object.entries(blob.skills)) {
    stmts.push(db.prepare("INSERT INTO skills (user_id, name, payload) VALUES (?, ?, ?)").bind(userId, name, JSON.stringify(skill)));
  }
  for (const flow of blob.workflows) {
    stmts.push(db.prepare("INSERT INTO workflows (user_id, id, payload) VALUES (?, ?, ?)").bind(userId, flow.id, JSON.stringify(flow)));
  }
  blob.ran.forEach((name, seq) => {
    stmts.push(db.prepare("INSERT INTO ran (user_id, seq, name) VALUES (?, ?, ?)").bind(userId, seq, name));
  });
  blob.files.forEach((file, seq) => {
    stmts.push(db.prepare("INSERT INTO files (user_id, seq, payload) VALUES (?, ?, ?)").bind(userId, seq, JSON.stringify(file)));
  });
  await db.batch(stmts);
}

export async function importLedgerIfEmpty(db: D1Database, userId: string, blob: SessionBlob): Promise<boolean> {
  await ensureD1Schema(db);
  const meta = await db.prepare("SELECT migrated FROM meta WHERE user_id = ?").bind(userId).first<{ migrated: number }>();
  if (meta?.migrated === 1) return false;
  const count = await db.prepare("SELECT COUNT(*) AS n FROM notes WHERE user_id = ?").bind(userId).first<{ n: number }>();
  if ((count?.n ?? 0) > 0) {
    await db.prepare("INSERT OR REPLACE INTO meta (user_id, migrated) VALUES (?, 1)").bind(userId).run();
    return false;
  }
  const session = loadSession(blob);
  await saveLedger(db, userId, session);
  await db.prepare("INSERT OR REPLACE INTO meta (user_id, migrated) VALUES (?, 1)").bind(userId).run();
  return true;
}
