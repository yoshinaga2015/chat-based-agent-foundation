import { describe, expect, it } from "vitest";
import type { UiPart } from "../types";
import { UI_PART_KINDS, renderUiPart } from "./registry";

const neutralDashboard: Extract<UiPart, { kind: "dashboard" }> = {
  kind: "dashboard",
  title: "Performance overview",
  metrics: [
    { id: "spend", label: "Total Ad Spends", value: "$110.42Mn" },
    { id: "sales", label: "Total Sales", value: "$425.5Mn" },
    { id: "roi", label: "Average ROI%", value: "342%", tone: "positive" },
    { id: "campaigns", label: "Active campaigns", value: "12" }
  ],
  widgets: [
    {
      id: "scatter",
      span: 1,
      title: "Ad spends vs Sales",
      body: {
        kind: "chart",
        chartType: "scatter",
        series: [
          { name: "spend", data: [1, 2, 3, 4] },
          { name: "sales", data: [2, 4, 5, 8] }
        ]
      }
    },
    {
      id: "funnel",
      span: 1,
      title: "Campaign funnel",
      body: {
        kind: "chart",
        chartType: "funnel",
        categories: ["Impressions", "Clicks", "Sign-ups", "Purchases"],
        series: [{ name: "funnel", data: [4_200_000, 310_000, 42_000, 9_800] }]
      }
    },
    {
      id: "regions",
      span: 2,
      title: "Regional campaign snapshot",
      body: {
        kind: "compare_table",
        columns: [
          { id: "id", label: "Campaign ID" },
          { id: "region", label: "Region" },
          { id: "roi", label: "ROI %" }
        ],
        rows: [
          { id: "NA-01", cells: { id: "NA-01", region: "North America", roi: 523 } },
          { id: "EU-01", cells: { id: "EU-01", region: "Europe", roi: 361 } }
        ]
      }
    }
  ]
};

describe("dashboard GenUI", () => {
  it("カタログに dashboard がある", () => {
    expect(UI_PART_KINDS).toContain("dashboard");
  });

  it("中立フィクスチャを render できる", () => {
    const node = renderUiPart(neutralDashboard);
    expect(node).toBeTruthy();
  });
});
