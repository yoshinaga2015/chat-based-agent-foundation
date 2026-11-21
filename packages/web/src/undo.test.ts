import { describe, expect, it } from "vitest";
import { addCard, createSession, undoLast, viewOf, writeNote } from "./session";

describe("作成 Undo の廃止", () => {
  it("ノート／カード作成は undoStack に積まない", () => {
    const noted = writeNote(createSession(), { id: "n1", title: "甲", body: "乙" }, 10);
    expect(noted.undoStack).toEqual([]);
    expect(viewOf(noted)).not.toHaveProperty("canUndo");
    const carded = addCard(noted, "下見", 20);
    expect(carded.undoStack).toEqual([]);
    expect(carded.desk.board.cards.size).toBe(1);
  });

  it("空スタックの undoLast は何も消さない", () => {
    const session = writeNote(createSession(), { id: "n1", title: "甲", body: "乙" }, 10);
    const next = undoLast(session, 11);
    expect(next.desk.ledger.notes.get("n1")?.deletedAt).toBeNull();
    expect(next.desk.notice).toBe("取り消せる操作はない");
  });
});
