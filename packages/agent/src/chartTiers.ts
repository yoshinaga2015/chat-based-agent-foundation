/** chartType の層。投資本線は core。テクニカル・強い近似は experimental。 */

import type { ChartType } from "./uiParts";

/** 不動産投資 GenUI の第一カタログ（削らない・マッパ優先）。 */
export const CHART_TIER_CORE = [
  "line",
  "area",
  "bar",
  "bar_horizontal",
  "pie",
  "donut",
  "scatter",
  "waterfall",
  "tornado",
  "bullet"
] as const satisfies readonly ChartType[];

/** 用途が固まってから本線化。描画は維持。 */
export const CHART_TIER_EXTENDED = [
  "coxcomb",
  "radar",
  "funnel",
  "gauge",
  "heatmap",
  "treemap",
  "sunburst",
  "boxplot",
  "sankey",
  "graph",
  "volume",
  "drawdown",
  "equity_drawdown",
  "histogram",
  "density",
  "ecdf",
  "errorbar",
  "forest",
  "pareto",
  "ridgeline",
  "qq",
  "violin"
] as const satisfies readonly ChartType[];

/** 相場テクニカル・空間近似。投資ジョブの必須チャネルには数えない。 */
export const CHART_TIER_EXPERIMENTAL = [
  "candlestick",
  "ohlc",
  "heikin_ashi",
  "renko",
  "point_figure",
  "volume_profile",
  "hexbin",
  "contour"
] as const satisfies readonly ChartType[];

export type ChartTier = "core" | "extended" | "experimental";

export function chartTierOf(type: ChartType): ChartTier {
  if ((CHART_TIER_CORE as readonly string[]).includes(type)) return "core";
  if ((CHART_TIER_EXTENDED as readonly string[]).includes(type)) return "extended";
  return "experimental";
}

export function isCoreChartType(type: string): type is (typeof CHART_TIER_CORE)[number] {
  return (CHART_TIER_CORE as readonly string[]).includes(type);
}
