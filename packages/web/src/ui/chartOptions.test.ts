import { describe, expect, it } from "vitest";
import {
  buildChartOption,
  chartDataTable,
  chartTooltipTrigger,
  CHART_TYPES,
  formatChartValue,
  isChartType
} from "./chartOptions";
import type { ChartType } from "../types";

const base = {
  kind: "chart" as const,
  title: "試算",
  categories: ["1", "2", "3", "4", "5"],
  series: [
    { name: "A", data: [10, 20, 15, 30, 25] },
    { name: "B", data: [5, 15, 12, 18, 22] }
  ]
};

const ohlc = {
  kind: "chart" as const,
  title: "OHLC",
  categories: ["1", "2", "3"],
  series: [
    { name: "open", data: [10, 12, 11] },
    { name: "close", data: [12, 11, 13] },
    { name: "low", data: [9, 10, 10] },
    { name: "high", data: [13, 14, 14] }
  ]
};

function fixture(chartType: ChartType) {
  if (
    chartType === "candlestick" ||
    chartType === "ohlc" ||
    chartType === "heikin_ashi" ||
    chartType === "renko"
  ) {
    return { ...ohlc, chartType };
  }
  if (chartType === "point_figure" || chartType === "volume_profile") {
    return {
      kind: "chart" as const,
      chartType,
      series: [
        { name: "close", data: [10, 11, 12, 11, 13, 14, 13, 15] },
        { name: "volume", data: [1, 2, 1, 3, 2, 2, 1, 4] }
      ]
    };
  }
  if (chartType === "boxplot") {
    return {
      ...base,
      chartType,
      series: [
        { name: "y1", data: [1, 2, 3, 4, 5] },
        { name: "y2", data: [2, 3, 4, 5, 6] },
        { name: "y3", data: [0, 1, 2, 3, 4] }
      ]
    };
  }
  if (chartType === "errorbar" || chartType === "forest") {
    return {
      kind: "chart" as const,
      chartType,
      categories: ["A", "B", "C"],
      series: [{ name: "effect", data: [1, 2, 1.5], errors: [0.2, 0.3, 0.25] }]
    };
  }
  if (chartType === "hexbin") {
    return {
      kind: "chart" as const,
      chartType,
      series: [
        { name: "x", data: [1, 2, 3, 2, 4, 5, 3] },
        { name: "y", data: [2, 1, 3, 4, 2, 5, 3] }
      ]
    };
  }
  if (chartType === "bullet") {
    return {
      kind: "chart" as const,
      chartType,
      series: [
        { name: "実績", data: [80] },
        { name: "target", data: [100] }
      ]
    };
  }
  if (chartType === "equity_drawdown" || chartType === "drawdown") {
    return {
      kind: "chart" as const,
      chartType,
      categories: ["1", "2", "3", "4", "5"],
      series: [{ name: "equity", data: [100, 110, 105, 120, 115] }]
    };
  }
  if (chartType === "qq" || chartType === "histogram" || chartType === "density" || chartType === "ecdf" || chartType === "violin") {
    return {
      kind: "chart" as const,
      chartType,
      series: [{ name: "x", data: [1, 2, 2, 3, 3, 3, 4, 5, 5, 6, 7, 8] }]
    };
  }
  if (chartType === "ridgeline") {
    return {
      kind: "chart" as const,
      chartType,
      series: [
        { name: "g1", data: [1, 2, 2, 3, 4] },
        { name: "g2", data: [2, 3, 3, 4, 5] }
      ]
    };
  }
  return { ...base, chartType };
}

describe("CHART_TYPES", () => {
  it("投資・統計込みで 40 種", () => {
    expect(CHART_TYPES).toHaveLength(40);
    expect(isChartType("waterfall")).toBe(true);
    expect(isChartType("histogram")).toBe(true);
    expect(isChartType("coxcomb")).toBe(true);
    expect(isChartType("map")).toBe(false);
  });
});

describe("buildChartOption", () => {
  it.each(CHART_TYPES)("%s が option を返す", (chartType: ChartType) => {
    const option = buildChartOption(fixture(chartType));
    expect(option.series).toBeDefined();
    expect(Array.isArray(option.series) ? option.series.length : 1).toBeGreaterThan(0);
  });

  it.each(CHART_TYPES)("%s は tooltip と aria を持つ", (chartType: ChartType) => {
    const option = buildChartOption(fixture(chartType));
    const tip = option.tooltip as { show?: boolean; trigger?: string; appendTo?: string } | undefined;
    expect(tip?.show).toBe(true);
    expect(tip?.trigger).toBe(chartTooltipTrigger(chartType));
    expect(tip?.appendTo).toBe("body");
    expect(option.aria).toMatchObject({ enabled: true, decal: { show: true } });
  });

  it("coxcomb は roseType area", () => {
    const option = buildChartOption(fixture("coxcomb"));
    const series = Array.isArray(option.series) ? option.series[0] : null;
    expect(series).toMatchObject({ type: "pie", roseType: "area" });
  });

  it("bullet は実績と目標だけ（枠バー無し・数値軸あり）", () => {
    const option = buildChartOption(fixture("bullet"), "dashboard");
    expect(option.legend).toMatchObject({ data: ["実績", "目標"] });
    const series = Array.isArray(option.series) ? option.series : [];
    expect(series.map((s) => (s as { name?: string }).name)).toEqual(["実績", "目標"]);
    const xAxis = option.xAxis as { type?: string; show?: boolean };
    expect(xAxis?.type).toBe("value");
    expect(xAxis?.show).not.toBe(false);
  });

  it("waterfall は両端を合計・中間を増減に分ける", () => {
    const option = buildChartOption({
      kind: "chart",
      chartType: "waterfall",
      categories: ["基準", "賃料", "空室", "結果"],
      series: [{ name: "NPV", data: [40, 18, -7, 51] }]
    });
    const series = Array.isArray(option.series) ? option.series : [];
    const byName = Object.fromEntries(
      series.map((s) => {
        const row = s as { name?: string; data?: number[] };
        return [row.name, row.data];
      })
    );
    expect(byName["合計"]).toEqual([40, 0, 0, 51]);
    expect(byName["増"]).toEqual([0, 18, 0, 0]);
    expect(byName["減"]).toEqual([0, 0, 7, 0]);
    expect(byName.base).toEqual([0, 40, 51, 0]);
  });

  it("reduceMotion で animation を止める", () => {
    const option = buildChartOption(fixture("line"), "dashboard", { reduceMotion: true });
    expect(option.animation).toBe(false);
  });

  it("isDarkMode で系列色が変わる", () => {
    const light = buildChartOption(fixture("line"), "default", { isDarkMode: false });
    const dark = buildChartOption(fixture("line"), "default", { isDarkMode: true });
    expect(light.color).not.toEqual(dark.color);
  });
});

describe("chart a11y helpers", () => {
  it("formatChartValue は数値をロケール整形", () => {
    expect(formatChartValue(922000)).toBe("922,000");
    expect(formatChartValue(null)).toBe("—");
  });

  it("chartDataTable は系列×カテゴリの表を返す", () => {
    const table = chartDataTable(fixture("line"));
    expect(table.columns).toEqual(["項目", "A", "B"]);
    expect(table.rows[0]).toEqual(["1", "10", "5"]);
  });
});
