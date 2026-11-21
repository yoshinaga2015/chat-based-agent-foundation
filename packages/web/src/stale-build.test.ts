import { describe, expect, it } from "vitest";
import { parseRestoreState } from "./stale-build";

describe("parseRestoreState", () => {
  it("有効な保存を返す", () => {
    const raw = JSON.stringify({
      v: 1,
      savedAt: 1_000,
      state: { pane: "kanban", draft: "下書き" }
    });
    expect(parseRestoreState(raw, 1_000)).toEqual({ pane: "kanban", draft: "下書き" });
  });

  it("期限切れは null", () => {
    const raw = JSON.stringify({
      v: 1,
      savedAt: 1,
      state: { pane: "chat", draft: "" }
    });
    expect(parseRestoreState(raw, 1 + 11 * 60 * 1000)).toBeNull();
  });

  it("形が違うと null", () => {
    expect(parseRestoreState("{}", 1)).toBeNull();
    expect(parseRestoreState(null, 1)).toBeNull();
  });
});
