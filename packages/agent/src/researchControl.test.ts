import { describe, expect, it } from "vitest";
import {
  assertFetchHost,
  buildGapQueryGuidance,
  classifyResearchQuery,
  evaluateCoverage,
  researchBudgetExhausted
} from "./researchControl";

describe("classifyResearchQuery", () => {
  it("推移は series", () => {
    expect(classifyResearchQuery("NVDAのここ数週の終値の推移")).toBe("series");
  });
  it("賃料相場は market", () => {
    expect(classifyResearchQuery("都心ワンルームの賃料相場の目安")).toBe("market");
  });
  it("政策金利は single", () => {
    expect(classifyResearchQuery("日銀の政策金利の最新の公表値")).toBe("single");
  });
});

describe("evaluateCoverage", () => {
  it("series は日付3・ホスト2が要る", () => {
    const status = evaluateCoverage({
      queryClass: "series",
      facts: [
        { id: "1", label: "a", value: "$1", asOf: "2026-01-01" },
        { id: "2", label: "b", value: "$2", asOf: "2026-01-08" },
        { id: "3", label: "c", value: "$3", asOf: "2026-01-15" }
      ],
      successHosts: ["a.example", "b.example"]
    });
    expect(status.met).toBe(true);
  });

  it("日付不足なら未達", () => {
    const status = evaluateCoverage({
      queryClass: "series",
      facts: [{ id: "1", label: "a", value: "$1", asOf: "2026-01-01" }],
      successHosts: ["a.example", "b.example"]
    });
    expect(status.met).toBe(false);
  });
});

describe("assertFetchHost", () => {
  it("失敗ホストの再試行を拒否", () => {
    expect(
      assertFetchHost({
        url: "https://bad.example/x",
        failedHosts: ["bad.example"],
        successByHost: {}
      })
    ).toMatchObject({ ok: false, reason: "failed_host" });
  });

  it("成功上限で拒否", () => {
    expect(
      assertFetchHost({
        url: "https://ok.example/x",
        failedHosts: [],
        successByHost: { "ok.example": 2 },
        maxSuccessPerHost: 2
      })
    ).toMatchObject({ ok: false, reason: "host_success_cap" });
  });
});

describe("researchBudgetExhausted", () => {
  it("精読上限で尽", () => {
    expect(
      researchBudgetExhausted({
        searches: 1,
        searchMax: 8,
        fetches: 8,
        fetchMax: 8,
        unusedCandidateHosts: 3
      })
    ).toBe(true);
  });
});

describe("buildGapQueryGuidance", () => {
  it("未達ならギャップ誘導", () => {
    const g = buildGapQueryGuidance({
      coverage: evaluateCoverage({
        queryClass: "series",
        facts: [],
        successHosts: []
      }),
      searchLeft: 2
    });
    expect(g).toMatch(/カバレッジ未達/);
    expect(g).not.toMatch(/yahoo|nasdaq/i);
  });
});
