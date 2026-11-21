import { describe, expect, it } from "vitest";
import { createSession, completeBrowserHandoff, speakAnswerText } from "./session";
import { loadSession } from "./blob";
import { currentBrowserHandoff } from "./threadHitl";

describe("speakAnswerText", () => {
  it("handoff 待ちの空本文はプレースホルダにしない", () => {
    expect(
      speakAnswerText({
        text: "",
        pendingBrowserHandoff: {
          reason: "other",
          task: "手元で調べる",
          liveViewUrl: "fudo-browser-run://session",
          createdAt: 1,
          expiresAt: 2
        }
      })
    ).toBe("");
  });

  it("handoff 無しの空はプレースホルダ", () => {
    expect(speakAnswerText({ text: "  ", pendingBrowserHandoff: null })).toBe("（応答が空でした）");
  });
});

describe("completeBrowserHandoff outcome", () => {
  it("期限切れは Failed 相当の userLine で再開する", async () => {
    const base = createSession();
    const createdAt = 1_000;
    const session = {
      ...base,
      desk: {
        ...base.desk,
        pendingBrowserHandoff: {
          reason: "login" as const,
          task: "ログインして完了を押す。",
          liveViewUrl: "https://example.com/live",
          createdAt,
          expiresAt: createdAt + 1
        }
      }
    };
    const draft = await completeBrowserHandoff(
      session,
      createdAt + 10_000,
      null,
      {},
      {},
      { outcome: "done" }
    );
    const line = draft.next.threads
      .find((t) => t.id === draft.next.activeThreadId)
      ?.lines.find((row) => row.role === "user");
    expect(line?.text).toBe("（引き継ぎ期限切れ）");
    expect(draft.next.desk.pendingBrowserHandoff).toBeNull();
  });

  it("localOnly 完了は手元調査の userLine（画面は戻らない）", async () => {
    const base = createSession();
    const now = Date.now();
    const session = {
      ...base,
      desk: {
        ...base.desk,
        pendingBrowserHandoff: {
          reason: "other" as const,
          task: "手元で単価を読みチャットで伝える。",
          liveViewUrl: "fudo-browser-run://session",
          createdAt: now,
          expiresAt: now + 60_000,
          localOnly: true
        }
      }
    };
    const draft = await completeBrowserHandoff(session, now, null, {}, {}, { outcome: "done" });
    const line = draft.next.threads
      .find((t) => t.id === draft.next.activeThreadId)
      ?.lines.find((row) => row.role === "user");
    expect(line?.text).toBe("（手元の調査完了）");
  });

  it("failed outcome は操作をやめた userLine", async () => {
    const base = createSession();
    const now = Date.now();
    const session = {
      ...base,
      desk: {
        ...base.desk,
        pendingBrowserHandoff: {
          reason: "other" as const,
          task: "地点を選ぶ。",
          liveViewUrl: "https://example.com/live",
          createdAt: now,
          expiresAt: now + 60_000
        }
      }
    };
    const draft = await completeBrowserHandoff(session, now, null, {}, {}, {
      outcome: "failed",
      note: "進めない"
    });
    const line = draft.next.threads
      .find((t) => t.id === draft.next.activeThreadId)
      ?.lines.find((row) => row.role === "user");
    expect(line?.text).toBe("（操作をやめた）進めない");
  });

  it("旧 blob の expiresAt 欠落は normalize で埋める", () => {
    const blob = {
      version: 1,
      activeThreadId: "t1",
      threads: [{ id: "t1", title: "無題", titleLocked: false, updatedAt: 1, lines: [] }],
      undo: [],
      notes: [],
      cards: [],
      skills: {},
      workflows: [],
      ran: [],
      files: [],
      pendingBrowserHandoff: {
        reason: "captcha",
        task: "画像確認を済ませる。",
        liveViewUrl: "https://example.com/live",
        createdAt: 500
      }
    };
    const loaded = loadSession(blob as never);
    expect(currentBrowserHandoff(loaded)?.expiresAt).toBe(500 + 5 * 60_000);
    expect(loaded.threads.find((thread) => thread.id === "t1")?.browserHandoff?.expiresAt).toBe(500 + 5 * 60_000);
  });
});
