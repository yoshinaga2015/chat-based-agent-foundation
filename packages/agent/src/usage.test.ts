import { describe, expect, it } from "vitest";
import { resolveDailyTokenCap, tokyoDay, tokensFromChatUsage, tokensFromResponsesUsage } from "./usage";
import { DAILY_TOKEN_CAP } from "./limits";

describe("usage 集計", () => {
  it("Chat Completions は prompt+completion", () => {
    expect(tokensFromChatUsage({ prompt_tokens: 10, completion_tokens: 5 })).toBe(15);
    expect(tokensFromChatUsage({ total_tokens: 99 })).toBe(99);
    expect(tokensFromChatUsage(null)).toBe(0);
  });

  it("Responses は input+output", () => {
    expect(tokensFromResponsesUsage({ input_tokens: 80, output_tokens: 20 })).toBe(100);
    expect(tokensFromResponsesUsage({ total_tokens: 44 })).toBe(44);
  });

  it("FUDO_DAILY_TOKEN_CAP で上書きできる。未設定と off は上限なし", () => {
    expect(resolveDailyTokenCap({})).toBeNull();
    expect(resolveDailyTokenCap({ FUDO_DAILY_TOKEN_CAP: "off" })).toBeNull();
    expect(resolveDailyTokenCap({ FUDO_DAILY_TOKEN_CAP: "unlimited" })).toBeNull();
    expect(resolveDailyTokenCap({ FUDO_DAILY_TOKEN_CAP: "-1" })).toBeNull();
    expect(resolveDailyTokenCap({ FUDO_DAILY_TOKEN_CAP: "100" })).toBe(100);
    expect(resolveDailyTokenCap({ FUDO_DAILY_TOKEN_CAP: "0" })).toBe(0);
    expect(resolveDailyTokenCap({ FUDO_DAILY_TOKEN_CAP: "nope" })).toBe(DAILY_TOKEN_CAP);
  });

  it("tokyoDay は YYYY-MM-DD", () => {
    expect(tokyoDay(Date.parse("2026-10-22T15:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
