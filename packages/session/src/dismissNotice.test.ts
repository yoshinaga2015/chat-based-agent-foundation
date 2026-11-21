import { describe, expect, it } from "vitest";
import { createSession, dismissNotice } from "./session";

describe("dismissNotice", () => {
  it("notice と abilityNotice を個別または両方消せる", () => {
    const base = createSession();
    const filled = {
      ...base,
      desk: {
        ...base.desk,
        notice: "実行計画を承認した。",
        abilityNotice: "接続 OK · 2ツール"
      }
    };
    expect(dismissNotice(filled, "notice").desk.notice).toBeNull();
    expect(dismissNotice(filled, "notice").desk.abilityNotice).toBe("接続 OK · 2ツール");
    expect(dismissNotice(filled, "ability").desk.abilityNotice).toBeNull();
    expect(dismissNotice(filled, "ability").desk.notice).toBe("実行計画を承認した。");
    const all = dismissNotice(filled, "all");
    expect(all.desk.notice).toBeNull();
    expect(all.desk.abilityNotice).toBeNull();
  });
});
