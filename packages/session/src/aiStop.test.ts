import { describe, expect, it } from "vitest";
import { createSession, draftSpeak, MODEL_ERROR_TEXT } from "./session";

describe("モデルが止まったとき", () => {
  it("3036 は理由と対処を出し、別モデルへ逃がさない", async () => {
    let calls = 0;
    const draft = await draftSpeak(createSession(), "こんにちは", 1, async () => {
      calls += 1;
      throw new Error("3036: You have used up your daily free allocation of 10,000 neurons.");
    });
    expect(calls).toBe(1);
    expect(draft.task).toBe("止めました");
    expect(draft.tokens.join("")).toContain("無料枠");
    expect(draft.tokens.join("")).toContain("AI Gateway");
  });

  it("クレジット不足（2052）も止める", async () => {
    const draft = await draftSpeak(createSession(), "こんにちは", 1, async () => {
      throw new Error("AiGatewayError: 2052: Insufficient unified billing balance for this request.");
    });
    expect(draft.tokens.join("")).toContain("クレジットが足りません");
  });

  it("理由の分からない失敗は接続失敗として出す", async () => {
    const draft = await draftSpeak(createSession(), "こんにちは", 1, async () => {
      throw new Error("3040: Capacity temporarily exceeded");
    });
    expect(draft.task).toBe("接続に失敗しました");
    expect(draft.tokens.join("")).toBe(MODEL_ERROR_TEXT);
  });
});
