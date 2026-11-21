import { describe, expect, it } from "vitest";
import {
  buildResearchPersistGuidance,
  formatBudgetRemain,
  hostnameOf
} from "./researchGuidance";

describe("hostnameOf", () => {
  it("ホストを返す", () => {
    expect(hostnameOf("https://Example.com/path")).toBe("example.com");
    expect(hostnameOf("not-a-url")).toBeNull();
  });
});

describe("formatBudgetRemain", () => {
  it("残回数を書く", () => {
    expect(
      formatBudgetRemain({ searchesUsed: 2, searchMax: 5, fetchesUsed: 1, fetchMax: 5 })
    ).toBe("検索残 3/5・精読残 4/5");
  });
});

describe("buildResearchPersistGuidance", () => {
  it("search_hits は別ホストと早期欠測禁止", () => {
    const g = buildResearchPersistGuidance({
      searchesUsed: 1,
      searchMax: 5,
      fetchesUsed: 0,
      fetchMax: 5,
      kind: "search_hits"
    });
    expect(g).toMatch(/検索残 4\/5/);
    expect(g).toMatch(/別ホスト/);
    expect(g).toMatch(/確認できない/);
  });

  it("fetch_fail は別ホストへ誘導", () => {
    const g = buildResearchPersistGuidance({
      searchesUsed: 3,
      searchMax: 5,
      fetchesUsed: 2,
      fetchMax: 5,
      triedHosts: ["a.example", "b.example"],
      kind: "fetch_fail"
    });
    expect(g).toMatch(/精読残 3\/5/);
    expect(g).toMatch(/既精読ホスト/);
    expect(g).toMatch(/別ホスト/);
    expect(g).not.toMatch(/yahoo|nasdaq|finance\.yahoo/i);
  });
});
