import { describe, expect, it } from "vitest";
import { createSession } from "./session";
import { dialogueFromSession, dumpSession, loadSession, mergeStores } from "./blob";
import { currentBrowserHandoff } from "./threadHitl";

describe("pendingBrowserHandoff 永続化", () => {
  it("dump / load で残る", () => {
    const base = createSession();
    const handoff = {
      reason: "login" as const,
      task: "ログインしてトップが見えたら完了を押す。",
      liveViewUrl: "https://fudo-browser-act.fly.dev/live-player?src=https%3A%2F%2Fapi.steel.dev%2Fv1%2Fsessions%2Fx%2Fplayer%2Ft",
      createdAt: 1_700_000_000_000,
      expiresAt: 1_700_000_000_000 + 15 * 60_000
    };
    const session = {
      ...base,
      desk: { ...base.desk, pendingBrowserHandoff: handoff }
    };
    const loaded = loadSession(dumpSession(session));
    expect(currentBrowserHandoff(loaded)).toEqual(handoff);
    expect(loaded.desk.pendingBrowserHandoff).toBeNull();
  });

  it("共有面の無い localOnly handoff は load で破棄", () => {
    const blob = {
      version: 1,
      activeThreadId: "t1",
      threads: [{ id: "t1", title: "無題", titleLocked: false, updatedAt: 1, lines: [] }],
      undo: [],
      ownedIds: [] as string[],
      notes: [],
      cards: [],
      skills: {},
      workflows: [],
      ran: [],
      files: [],
      pendingBrowserHandoff: {
        reason: "other",
        task: "手元で調べる。",
        liveViewUrl: "fudo-browser-run://session",
        createdAt: 1,
        expiresAt: 2,
        localOnly: true
      }
    };
    expect(currentBrowserHandoff(loadSession(blob as never))).toBeNull();
  });

  it("dialogueFromSession → mergeStores でも残る（Workers 経路）", () => {
    const base = createSession();
    const handoff = {
      reason: "other" as const,
      task: "地図上の地点を選んだら完了を押す。",
      liveViewUrl: "http://127.0.0.1:4176/live-player?src=https%3A%2F%2Fapi.steel.dev%2Fv1%2Fsessions%2Fy%2Fplayer%2Ft",
      createdAt: 42,
      expiresAt: 42 + 10 * 60_000
    };
    const session = {
      ...base,
      desk: { ...base.desk, pendingBrowserHandoff: handoff }
    };
    const dialogue = dialogueFromSession(session);
    const merged = mergeStores(dialogue, {
      notes: [],
      cards: [],
      skills: {},
      workflows: [],
      ran: [],
      files: []
    });
    expect(currentBrowserHandoff(merged)).toEqual(handoff);
  });
});

describe("ThreadLine.ui 永続化", () => {
  it("dump / load で UiPart が残る", () => {
    const base = createSession();
    const ui = [
      {
        kind: "sources" as const,
        items: [{ title: "例", url: "https://example.com/", snippet: "s" }]
      }
    ];
    const thread = base.threads[0] ?? {
      id: "t1",
      title: "無題",
      titleLocked: false,
      updatedAt: 1,
      lines: []
    };
    const session = {
      ...base,
      activeThreadId: thread.id,
      threads: [
        {
          ...thread,
          lines: [
            { role: "user" as const, text: "調べて" },
            { role: "assistant" as const, text: "これです。", ui }
          ]
        }
      ]
    };
    const loaded = loadSession(dumpSession(session));
    const line = loaded.threads.find((t) => t.id === thread.id)?.lines[1];
    expect(line?.ui).toEqual(ui);
  });
});
