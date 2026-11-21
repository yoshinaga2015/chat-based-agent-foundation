import { Chart, ChartPalette, type KumoChartOption } from "@cloudflare/kumo";
import { LineChart } from "echarts/charts";
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useSyncExternalStore } from "react";
import { getResolvedColorMode, subscribeResolvedColorMode } from "./color-mode";

echarts.use([
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  AriaComponent,
  CanvasRenderer
]);

export function YearChart({ names, rows }: { names: string[]; rows: (number | null)[][] }) {
  const isDarkMode = useSyncExternalStore(
    subscribeResolvedColorMode,
    () => getResolvedColorMode() === "dark",
    () => false
  );
  const options: KumoChartOption = {
    color: names.map((_, index) => ChartPalette.categorical(index, isDarkMode)),
    legend: { data: names, bottom: 0, left: 0 },
    grid: { left: 4, right: 16, top: 12, bottom: 36, containLabel: true },
    tooltip: {
      show: true,
      trigger: "axis",
      triggerOn: "mousemove|click|mousewheel",
      appendTo: "body",
      valueFormatter: (value: unknown) =>
        typeof value === "number" && Number.isFinite(value)
          ? new Intl.NumberFormat("ja-JP").format(value)
          : value == null
            ? "—"
            : String(value)
    },
    aria: { enabled: true, decal: { show: true } },
    xAxis: { type: "category", data: rows[0]?.map((_, index) => String(index + 1)) ?? [] },
    yAxis: { type: "value" },
    series: names.map((name, index) => ({
      name,
      type: "line",
      showSymbol: false,
      data: rows[index] ?? []
    }))
  };
  return <Chart echarts={echarts} height={200} options={options} isDarkMode={isDarkMode} />;
}
