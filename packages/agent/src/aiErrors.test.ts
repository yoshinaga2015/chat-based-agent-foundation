import { describe, expect, it } from "vitest";
import { aiStopReason, aiStopText } from "./aiErrors";

describe("aiStopReason", () => {
  it("3036 は無料枠切れ", () => {
    expect(aiStopReason(new Error("3036: You have used up your daily free allocation of 10,000 neurons."))).toBe("free_allocation");
  });

  it("4006（REST・バインディングでの無料枠切れ）も無料枠切れ", () => {
    expect(
      aiStopReason(
        new Error(
          "AiError: AiError: you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare's Workers Paid plan if you would like to continue usage. (41ede2f9-b0d7-4ce6-bbd9-04f555741e36)"
        )
      )
    ).toBe("free_allocation");
    expect(aiStopReason(new Error("4006: daily free allocation exceeded"))).toBe("free_allocation");
  });

  it("5035 は Workers Paid 必須", () => {
    expect(aiStopReason(new Error("AiError: 5035: This model requires a Workers Paid plan."))).toBe("paid_plan");
  });

  it("2052・2021・残高不足はクレジット不足", () => {
    expect(aiStopReason(new Error("AiGatewayError: 2052: Insufficient unified billing balance for this request."))).toBe("credit");
    expect(aiStopReason(new Error("2021: Insufficient balance; add money to your gateway or use BYOK"))).toBe("credit");
  });

  it("それ以外は止める理由にしない", () => {
    expect(aiStopReason(new Error("3040: Capacity temporarily exceeded"))).toBeNull();
    expect(aiStopText("x")).toBeNull();
  });

  it("対処を文で返す", () => {
    expect(aiStopText(new Error("3036"))).toContain("AI Gateway でクレジットを購入するか");
  });
});
