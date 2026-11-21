import { describe, expect, it } from "vitest";
import { createSession, createThread, mergeSpeakCommit, selectThread } from "./session";
import { DEFAULT_THREAD_TITLE } from "agent";

describe("mergeSpeakCommit", () => {
  it("発信スレッドの会話を残し、新規スレッドの active を保つ", () => {
    const empty = createThread(createSession(), 1);
    const originId = empty.activeThreadId!;
    const base = {
      ...empty,
      threads: empty.threads.map((thread) =>
        thread.id === originId
          ? { ...thread, lines: [{ role: "user" as const, text: "開けて" }] }
          : thread
      )
    };
    const spoken = {
      ...base,
      threads: base.threads.map((thread) =>
        thread.id === originId
          ? {
              ...thread,
              title: "地価マップ",
              updatedAt: 5,
              lines: [
                { role: "user" as const, text: "開けて" },
                { role: "assistant" as const, text: "開きました" }
              ]
            }
          : thread
      ),
      activeThreadId: originId
    };
    const latest = createThread(base, 3);
    expect(latest.activeThreadId).not.toBe(originId);
    expect(latest.threads).toHaveLength(2);

    const merged = mergeSpeakCommit(latest, spoken, originId);
    expect(merged.activeThreadId).toBe(latest.activeThreadId);
    expect(merged.threads).toHaveLength(2);
    const origin = merged.threads.find((thread) => thread.id === originId);
    expect(origin?.lines).toHaveLength(2);
    expect(origin?.title).toBe("地価マップ");
    expect(merged.threads.find((thread) => thread.id === latest.activeThreadId)?.lines).toEqual([]);
  });

  it("手動改名済みタイトルは speak 側で上書きしない", () => {
    const empty = createThread(createSession(), 1);
    const originId = empty.activeThreadId!;
    const renamed = {
      ...empty,
      threads: empty.threads.map((thread) =>
        thread.id === originId
          ? {
              ...thread,
              title: "手元の名前",
              titleLocked: true,
              lines: [{ role: "user" as const, text: "hi" }]
            }
          : thread
      )
    };
    const spoken = {
      ...renamed,
      threads: renamed.threads.map((thread) =>
        thread.id === originId
          ? {
              ...thread,
              title: "自動タイトル",
              titleLocked: false,
              lines: [
                { role: "user" as const, text: "hi" },
                { role: "assistant" as const, text: "yo" }
              ]
            }
          : thread
      )
    };
    const latest = createThread(renamed, 2);
    const merged = mergeSpeakCommit(latest, spoken, originId);
    expect(merged.threads.find((t) => t.id === originId)?.title).toBe("手元の名前");
  });

  it("選択を戻したときは origin の lines を表示対象にできる", () => {
    const empty = createThread(createSession(), 1);
    const originId = empty.activeThreadId!;
    const base = {
      ...empty,
      threads: empty.threads.map((thread) =>
        thread.id === originId
          ? { ...thread, lines: [{ role: "user" as const, text: "a" }] }
          : thread
      )
    };
    const spoken = {
      ...base,
      threads: base.threads.map((thread) =>
        thread.id === originId
          ? {
              ...thread,
              title: DEFAULT_THREAD_TITLE,
              lines: [
                { role: "user" as const, text: "a" },
                { role: "assistant" as const, text: "b" }
              ]
            }
          : thread
      )
    };
    const withNew = createThread(base, 2);
    const back = selectThread(withNew, originId);
    const merged = mergeSpeakCommit(back, spoken, originId);
    expect(merged.activeThreadId).toBe(originId);
    expect(merged.threads.find((t) => t.id === originId)?.lines).toHaveLength(2);
  });
});
