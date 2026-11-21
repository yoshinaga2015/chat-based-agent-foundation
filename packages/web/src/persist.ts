// 移行用の手元ファイル読み書き。製品正本は packages/api の DO+D1。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createSession, dumpSession, loadSession, type Session, type SessionBlob } from "session";

export type { SessionBlob };
export { dumpSession, loadSession };

export function defaultPersistPath(): string {
  return resolve(process.cwd(), ".fudo", "session.json");
}

export function readPersistedSession(path = defaultPersistPath()): Session {
  if (!existsSync(path)) return createSession();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as SessionBlob;
    return loadSession(parsed);
  } catch {
    return createSession();
  }
}

export function writePersistedSession(session: Session, path = defaultPersistPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(dumpSession(session)), "utf8");
  renameSync(tmp, path);
}

export function takeMigrationBlob(path = defaultPersistPath()): SessionBlob | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SessionBlob;
  } catch {
    return null;
  }
}
