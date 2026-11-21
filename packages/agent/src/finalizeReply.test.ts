import { describe, expect, it } from "vitest";
import { pickFinalReply, synthesizeAfterTools } from "./finalizeReply";

describe("finalizeReply", () => {
  it("本文があればそのまま", () => {
    expect(pickFinalReply("  置きました。 ", [{ ok: true }])).toBe("置きました。");
  });

  it("ツール無しの空は空のまま", () => {
    expect(pickFinalReply("", [])).toBe("");
  });

  it("失敗のみなら続き不可の文", () => {
    expect(synthesizeAfterTools([{ ok: false, reason: "act_error" }])).toMatch(/続きませんでした/);
  });

  it("成功と失敗が混ざれば一部まで進んだ文", () => {
    expect(synthesizeAfterTools([{ ok: true }, { ok: false }])).toMatch(/一部まで/);
  });

  it("成功のみなら一通り終わった文", () => {
    expect(synthesizeAfterTools([{ ok: true }, { ok: true }])).toMatch(/一通り/);
  });
});
