import { describe, expect, it } from "vitest";
import { numberTokens, ungroundedTokens } from "./grounding";

describe("数値の出典照合", () => {
  it("万・億・全角を円へ展開し、百分率と小数を同じとみなす", () => {
    const text = "価格は１，４４０万円、利回りは4.5%、土地は50.25㎡、返済は30年。";
    expect(ungroundedTokens(text, [14_400_000, 0.045, 50.25, 30])).toEqual([]);
    expect(numberTokens("1億4400万円")[0]?.value).toBe(144_000_000);
    expect(numberTokens("1.5億円")[0]?.value).toBe(150_000_000);
  });

  it("出典に無い金額だけを残す", () => {
    const missed = ungroundedTokens("満室賃料は1,440,000円です。", [1_000_000]);
    expect(missed.map((token) => token.value)).toEqual([1_440_000]);
  });

  it("年号・日付・件数は照合しない", () => {
    expect(numberTokens("2026年10月15日に3件、順位は1位。")).toEqual([]);
  });
});
