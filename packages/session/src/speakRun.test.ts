import { describe, expect, it } from "vitest";
import { createSpeakRunMemory } from "./speakRun";

describe("createSpeakRunMemory", () => {
  it("append したイベントを after から読め、finish で active が消える", () => {
    const store = createSpeakRunMemory();
    store.start({ runId: "r1", threadId: "t1", generation: 1 });
    store.append("r1", { name: "status", data: { text: "考えています…" } });
    store.append("r1", { name: "tool", data: { id: "1" } });
    expect(store.active()).toEqual({ runId: "r1", threadId: "t1" });
    expect(store.read("r1", 0)?.events).toHaveLength(2);
    expect(store.read("r1", 1)?.events).toHaveLength(1);
    store.append("r1", { name: "done", data: { interrupted: false } });
    store.finish("r1", "done");
    expect(store.active()).toBeNull();
    expect(store.read("r1", 0)?.status).toBe("done");
  });

  it("finish 後の append は無視する", () => {
    const store = createSpeakRunMemory();
    store.start({ runId: "r1", threadId: null, generation: 1 });
    store.finish("r1", "interrupted");
    store.append("r1", { name: "token", data: { text: "x" } });
    expect(store.read("r1", 0)?.events).toHaveLength(0);
  });
});
