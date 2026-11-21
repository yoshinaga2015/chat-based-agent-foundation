import { installAi } from "agent";
import { afterEach, describe, expect, it } from "vitest";
import { dumpSession, loadSession } from "./blob";
import { createSession, createThread, draftSpeak, setThreadModel, viewOf, type Session } from "./session";

const NEMOTRON = "@cf/nvidia/nemotron-3-120b-a12b";

function withThread(): Session {
  return createThread(createSession(), 1);
}

describe("スレッドごとの対話モデル", () => {
  afterEach(() => installAi(null));

  it("一覧の外のモデル名は保存しない", () => {
    const session = withThread();
    expect(setThreadModel(session, session.activeThreadId!, "anthropic/claude-opus-9")).toBeNull();
    expect(setThreadModel(session, "t-missing", NEMOTRON)).toBeNull();
  });

  it("選んだモデルは保存して読み戻しても残り、新しいスレッドが引き継ぐ", () => {
    const chosen = setThreadModel(withThread(), "t1", NEMOTRON)!;
    expect((viewOf(loadSession(dumpSession(chosen))) as { model: string }).model).toBe(NEMOTRON);
    const next = createThread({ ...chosen, threads: chosen.threads.map((t) => ({ ...t, lines: [{ role: "user" as const, text: "x" }] })) }, 2);
    expect(next.activeThreadId).toBe("t2");
    expect(next.threads.find((thread) => thread.id === "t2")?.model).toBe(NEMOTRON);
  });

  it("発話・会話名はスレッドのモデルで呼び、応答にモデルを記録する", async () => {
    const called: string[] = [];
    installAi({
      run: async (model) => {
        called.push(model);
        return { choices: [{ message: { role: "assistant", content: "はい" } }] };
      },
      websearch: async () => new Response("{}")
    });
    const session = setThreadModel(withThread(), "t1", NEMOTRON)!;
    const draft = await draftSpeak(session, "こんにちは", 2);
    expect(called.length).toBeGreaterThanOrEqual(2);
    expect(new Set(called)).toEqual(new Set([NEMOTRON]));
    const reply = draft.next.threads.find((thread) => thread.id === "t1")?.lines.at(-1);
    expect(reply).toMatchObject({ role: "assistant", text: "はい", model: NEMOTRON });
  });
});
