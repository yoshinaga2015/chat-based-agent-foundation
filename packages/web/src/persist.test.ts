import { deskAddCard, deskWriteNote } from "agent";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSession } from "./session";
import { dumpSession, loadSession, readPersistedSession, writePersistedSession } from "./persist";

describe("セッション永続化", () => {
  it("ノート・カード・スレッドが往復する", () => {
    let session = createSession();
    session = {
      ...session,
      desk: deskWriteNote(deskAddCard(session.desk, "下見", 1), { id: "n1", title: "金利", body: "要確認" }, 1)
    };
    session = {
      ...session,
      threads: [{ id: "t1", title: "対話", titleLocked: false, updatedAt: 1, lines: [{ role: "user", text: "こんにちは" }] }],
      activeThreadId: "t1",
      seq: 1
    };
    const restored = loadSession(dumpSession(session));
    expect(restored.desk.ledger.notes.get("n1")?.title).toBe("金利");
    expect(restored.desk.board.cards.size).toBe(1);
    expect(restored.threads[0]?.lines[0]?.text).toBe("こんにちは");
  });

  it("ファイルへ書いて読み戻せる", () => {
    const dir = mkdtempSync(join(tmpdir(), "fudo-persist-"));
    const path = join(dir, "session.json");
    try {
      let session = createSession();
      session = { ...session, desk: deskWriteNote(session.desk, { id: "n2", title: "甲", body: "乙" }, 2) };
      writePersistedSession(session, path);
      const restored = readPersistedSession(path);
      expect(restored.desk.ledger.notes.get("n2")?.body).toBe("乙");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
