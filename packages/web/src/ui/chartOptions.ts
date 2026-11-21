/** UiPart chart → Kumo/ECharts option。カタログ外は line に落とす。 */

import { ChartPalette, type KumoChartOption } from "@cloudflare/kumo";
import type { ChartType, UiPart } from "../types";

export type ChartPartData = Extract<UiPart, { kind: "chart" }>;

/** Controlled GenUI が描画できる chartType。 */
export const CHART_TYPES = [
  "line",
  "area",
  "bar",
  "bar_horizontal",
  "pie",
  "donut",
  "coxcomb",
  "scatter",
  "radar",
  "funnel",
  "gauge",
  "heatmap",
  "treemap",
  "sunburst",
  "boxplot",
  "candlestick",
  "sankey",
  "graph",
  "waterfall",
  "ohlc",
  "volume",
  "drawdown",
  "equity_drawdown",
  "bullet",
  "tornado",
  "heikin_ashi",
  "renko",
  "point_figure",
  "volume_profile",
  "histogram",
  "density",
  "ecdf",
  "violin",
  "qq",
  "errorbar",
  "forest",
  "hexbin",
  "contour",
  "ridgeline",
  "pareto"
] as const satisfies readonly ChartType[];

export function isChartType(value: string): value is ChartType {
  return (CHART_TYPES as readonly string[]).includes(value);
}

/** CustomChart 等、Kumo の Series ユニオンに載らない構成を通す。 */
function option(o: Omit<KumoChartOption, "series"> & { series?: unknown }): KumoChartOption {
  return o as KumoChartOption;
}

/** buildChartOption 呼び出し中だけ有効。Canvas は CSS 変数を解決しないためパレットを切る。 */
let paletteDark = false;

function catColor(index: number): string {
  return ChartPalette.categorical(index, paletteDark);
}

function cats(part: ChartPartData): string[] {
  if (part.categories?.length) return part.categories;
  const n = Math.max(0, ...part.series.map((s) => s.data.length));
  return Array.from({ length: n }, (_, i) => String(i + 1));
}

function colors(n: number): string[] {
  return Array.from({ length: Math.max(n, 1) }, (_, i) => catColor(i));
}

function namedSlices(part: ChartPartData): { name: string; value: number }[] {
  const categories = cats(part);
  const values = part.series[0]?.data ?? [];
  return values.map((value, i) => ({
    name: categories[i] ?? part.series[0]?.name ?? String(i + 1),
    value
  }));
}

function seriesByName(part: ChartPartData, ...names: string[]): number[] | undefined {
  const map = new Map(part.series.map((s) => [s.name.toLowerCase(), s.data]));
  for (const name of names) {
    const hit = map.get(name.toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

function ohlcRows(part: ChartPartData): { categories: string[]; rows: number[][] } {
  const categories = cats(part);
  const open = seriesByName(part, "open", "始値", "o");
  const close = seriesByName(part, "close", "終値", "c");
  const low = seriesByName(part, "low", "安値", "l");
  const high = seriesByName(part, "high", "高値", "h");
  if (open && close && low && high) {
    const n = Math.min(open.length, close.length, low.length, high.length, categories.length);
    return {
      categories: categories.slice(0, n),
      rows: Array.from({ length: n }, (_, i) => [open[i]!, close[i]!, low[i]!, high[i]!])
    };
  }
  const raw = part.series[0]?.data ?? [];
  const n = Math.floor(raw.length / 4);
  return {
    categories: categories.slice(0, n),
    rows: Array.from({ length: n }, (_, i) => raw.slice(i * 4, i * 4 + 4))
  };
}

function cartesian(
  part: ChartPartData,
  seriesType: "line" | "bar" | "scatter",
  options: { horizontal?: boolean; area?: boolean; step?: "end" | "middle" | "start" } = {}
): KumoChartOption {
  const categories = cats(part);
  const horizontal = options.horizontal === true;
  return {
    color: colors(part.series.length),
    legend: { data: part.series.map((s) => s.name), bottom: 0, left: 0 },
    grid: { left: 4, right: 16, top: 12, bottom: 36, containLabel: true },
    xAxis: horizontal ? { type: "value" } : { type: "category", data: categories },
    yAxis: horizontal ? { type: "category", data: categories } : { type: "value" },
    series: part.series.map((s) => ({
      name: s.name,
      type: seriesType,
      showSymbol: seriesType === "scatter",
      ...(options.area && seriesType === "line" ? { areaStyle: {} } : {}),
      ...(options.step && seriesType === "line" ? { step: options.step } : {}),
      data: seriesType === "scatter" ? s.data.map((v, i) => [i, v]) : s.data
    }))
  };
}

function pieLike(
  part: ChartPartData,
  kind: "pie" | "donut" | "coxcomb" | "funnel"
): KumoChartOption {
  const data = namedSlices(part);
  if (kind === "funnel") {
    return {
      color: colors(data.length),
      series: [{ type: "funnel", data, sort: "descending", gap: 2 }]
    };
  }
  const coxcomb = kind === "coxcomb";
  return {
    color: colors(data.length),
    series: [
      {
        type: "pie",
        radius: coxcomb
          ? (["12%", "72%"] as [string, string])
          : kind === "donut"
            ? (["42%", "68%"] as [string, string])
            : "68%",
        ...(coxcomb ? { roseType: "area" as const } : {}),
        data
      }
    ]
  };
}

function radarOption(part: ChartPartData): KumoChartOption {
  const categories = cats(part);
  const indicators = categories.map((name) => {
    const max = Math.max(
      1,
      ...part.series.map((s) => {
        const i = categories.indexOf(name);
        return Math.abs(s.data[i] ?? 0) * 1.2;
      })
    );
    return { name, max };
  });
  return {
    color: colors(part.series.length),
    legend: { data: part.series.map((s) => s.name), bottom: 0, left: 0 },
    radar: { indicator: indicators },
    series: [
      {
        type: "radar",
        data: part.series.map((s) => ({ name: s.name, value: s.data.slice(0, categories.length) }))
      }
    ]
  };
}

function gaugeOption(part: ChartPartData): KumoChartOption {
  const value = part.series[0]?.data[0] ?? 0;
  const name = part.series[0]?.name ?? part.title ?? "";
  return {
    series: [
      {
        type: "gauge",
        min: 0,
        max: Math.max(100, Math.abs(value) * 1.25, 1),
        data: [{ value, name }]
      }
    ]
  };
}

function heatmapOption(part: ChartPartData): KumoChartOption {
  const categories = cats(part);
  const yLabels = part.series.map((s) => s.name);
  const points: [number, number, number][] = [];
  let max = 1;
  part.series.forEach((s, yi) => {
    s.data.forEach((v, xi) => {
      points.push([xi, yi, v]);
      max = Math.max(max, Math.abs(v));
    });
  });
  return {
    tooltip: {},
    grid: { left: 48, right: 16, top: 12, bottom: 36, containLabel: true },
    xAxis: { type: "category", data: categories },
    yAxis: { type: "category", data: yLabels },
    visualMap: {
      min: 0,
      max,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 0
    },
    series: [{ type: "heatmap", data: points }]
  };
}

function treeLike(part: ChartPartData, type: "treemap" | "sunburst"): KumoChartOption {
  const children = namedSlices(part).map((d) => ({ name: d.name, value: d.value }));
  return {
    color: colors(children.length),
    series: [
      {
        type,
        data: [{ name: part.title || part.series[0]?.name || "構成", children }],
        ...(type === "sunburst" ? { radius: [0, "90%"] } : {})
      }
    ]
  };
}

function boxplotOption(part: ChartPartData): KumoChartOption {
  const categories = cats(part);
  const raw = part.series[0]?.data ?? [];
  const boxes: number[][] = [];
  if (raw.length === categories.length * 5) {
    for (let i = 0; i < categories.length; i += 1) boxes.push(raw.slice(i * 5, i * 5 + 5));
  } else if (part.series.every((s) => s.data.length >= 5)) {
    for (let i = 0; i < categories.length; i += 1) {
      const col = part.series.map((s) => s.data[i] ?? 0).sort((a, b) => a - b);
      const q = (p: number) => col[Math.min(col.length - 1, Math.floor(p * (col.length - 1)))]!;
      boxes.push([col[0]!, q(0.25), q(0.5), q(0.75), col[col.length - 1]!]);
    }
  } else {
    return cartesian(part, "bar");
  }
  return {
    grid: { left: 4, right: 16, top: 12, bottom: 36, containLabel: true },
    xAxis: { type: "category", data: categories.slice(0, boxes.length) },
    yAxis: { type: "value" },
    series: [{ type: "boxplot", data: boxes }]
  };
}

function candlestickOption(part: ChartPartData): KumoChartOption {
  const { categories, rows } = ohlcRows(part);
  if (!rows.length) return cartesian(part, "line");
  return {
    grid: { left: 4, right: 16, top: 12, bottom: 36, containLabel: true },
    xAxis: { type: "category", data: categories },
    yAxis: { type: "value" },
    series: [{ type: "candlestick", data: rows }]
  };
}

function flowOption(part: ChartPartData, type: "sankey" | "graph"): KumoChartOption {
  const links = part.links;
  const slices = namedSlices(part);
  const nodes =
    part.nodes?.map((n) => ({ name: n.name })) ??
    [...new Set(slices.map((s) => s.name))].map((name) => ({ name }));
  const edgeList =
    links && links.length
      ? links.map((l) => ({ source: l.source, target: l.target, value: l.value }))
      : slices.slice(0, -1).map((s, i) => ({
          source: s.name,
          target: slices[i + 1]!.name,
          value: Math.max(0.01, Math.abs(s.value))
        }));
  if (type === "sankey") {
    return {
      series: [{ type: "sankey", data: nodes, links: edgeList, emphasis: { focus: "adjacency" } }]
    };
  }
  return {
    series: [
      {
        type: "graph",
        layout: "force",
        data: nodes.map((n, i) => ({
          ...n,
          symbolSize: 24 + (slices[i]?.value ? Math.min(40, Math.abs(slices[i]!.value) / 10) : 0)
        })),
        links: edgeList,
        roam: true,
        label: { show: true }
      }
    ]
  };
}

/**
 * ウォーターフォール。
 * 系列は `[開始合計, …増減, 終了合計]`。両端は水準、中間はデルタ。
 * 合計柱は「増」と色を分け、柱のあいだに接続線を引く。
 */
function waterfallOption(part: ChartPartData): KumoChartOption {
  const categories = cats(part);
  const values = part.series[0]?.data ?? [];
  const n = Math.min(categories.length, values.length);
  const base: number[] = [];
  const total: number[] = [];
  const rise: number[] = [];
  const fall: number[] = [];
  const levelAfter: number[] = [];
  let running = 0;
  for (let i = 0; i < n; i += 1) {
    const v = values[i]!;
    const edge = i === 0 || i === n - 1;
    if (edge) {
      base.push(Math.min(0, v));
      total.push(Math.max(0, v));
      rise.push(0);
      fall.push(v < 0 ? -v : 0);
      running = v;
    } else if (v >= 0) {
      base.push(running);
      total.push(0);
      rise.push(v);
      fall.push(0);
      running += v;
    } else {
      base.push(running + v);
      total.push(0);
      rise.push(0);
      fall.push(-v);
      running += v;
    }
    levelAfter.push(running);
  }
  const connectors = Array.from({ length: Math.max(0, n - 1) }, (_, i) => [
    { coord: [i, levelAfter[i]!] },
    { coord: [i + 1, levelAfter[i]!] }
  ]);
  return option({
    legend: { data: ["合計", "増", "減"], bottom: 0, left: 0 },
    grid: { left: 4, right: 16, top: 12, bottom: 36, containLabel: true },
    xAxis: { type: "category", data: categories.slice(0, n) },
    yAxis: { type: "value" },
    series: [
      {
        name: "base",
        type: "bar",
        stack: "wf",
        silent: true,
        itemStyle: { color: "transparent", borderColor: "transparent" },
        data: base,
        emphasis: { disabled: true },
        tooltip: { show: false }
      },
      {
        name: "合計",
        type: "bar",
        stack: "wf",
        data: total,
        itemStyle: { color: catColor(2) },
        markLine: {
          symbol: ["none", "none"],
          label: { show: false },
          lineStyle: {
            type: "dashed",
            width: 1,
            color: paletteDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.35)"
          },
          data: connectors,
          silent: true
        }
      },
      { name: "増", type: "bar", stack: "wf", data: rise, itemStyle: { color: catColor(0) } },
      { name: "減", type: "bar", stack: "wf", data: fall, itemStyle: { color: catColor(1) } }
    ]
  });
}

/** OHLC 棒（custom）。 */
function ohlcOption(part: ChartPartData): KumoChartOption {
  const { categories, rows } = ohlcRows(part);
  if (!rows.length) return candlestickOption(part);
  return option({
    grid: { left: 4, right: 16, top: 12, bottom: 36, containLabel: true },
    xAxis: { type: "category", data: categories },
    yAxis: { type: "value", scale: true },
    series: [
      {
        type: "custom",
        renderItem: (_params: unknown, api: { value: (i: number) => number; coord: (v: number[]) => number[]; size: (v: number[]) => number[] }) => {
          const x = api.value(0);
          const open = api.value(1);
          const close = api.value(2);
          const low = api.value(3);
          const high = api.value(4);
          const lowP = api.coord([x, low]);
          const highP = api.coord([x, high]);
          const openP = api.coord([x, open]);
          const closeP = api.coord([x, close]);
          const half = api.size([1, 0])[0]! * 0.35;
          const color = close >= open ? catColor(0) : catColor(1);
          return {
            type: "group",
            children: [
              {
                type: "line",
                shape: { x1: lowP[0], y1: lowP[1], x2: highP[0], y2: highP[1] },
                style: { stroke: color, lineWidth: 1 }
              },
              {
                type: "line",
                shape: { x1: openP[0]! - half, y1: openP[1], x2: openP[0], y2: openP[1] },
                style: { stroke: color, lineWidth: 1.5 }
              },
              {
                type: "line",
                shape: { x1: closeP[0], y1: closeP[1], x2: closeP[0]! + half, y2: closeP[1] },
                style: { stroke: color, lineWidth: 1.5 }
              }
            ]
          };
        },
        encode: { x: 0, y: [1, 2, 3, 4] },
        data: rows.map((r, i) => [i, r[0], r[1], r[2], r[3]])
      }
    ]
  });
}

function volumeOption(part: ChartPartData): KumoChartOption {
  const opt = cartesian(part, "bar");
  return {
    ...opt,
    series: (Array.isArray(opt.series) ? opt.series : []).map((s) => ({
      ...s,
      itemStyle: { color: catColor(2), opacity: 0.7 }
    }))
  };
}

function drawdownsFromEquity(equity: number[]): number[] {
  let peak = equity[0] ?? 0;
  return equity.map((v) => {
    peak = Math.max(peak, v);
    return peak === 0 ? 0 : (v - peak) / Math.abs(peak);
  });
}

function drawdownOption(part: ChartPartData): KumoChartOption {
  const equity = part.series[0]?.data ?? [];
  const dd =
    part.series.find((s) => /drawdown|dd/i.test(s.name))?.data ?? drawdownsFromEquity(equity);
  const categories = cats(part).slice(0, dd.length);
  return {
    grid: { left: 4, right: 16, top: 12, bottom: 36, containLabel: true },
    xAxis: { type: "category", data: categories },
    yAxis: { type: "value", axisLabel: { formatter: (v: number) => `${(v * 100).toFixed(0)}%` } },
    series: [
      {
        name: "Drawdown",
        type: "line",
        areaStyle: { color: catColor(1) },
        data: dd,
        showSymbol: false
      }
    ]
  };
}

function equityDrawdownOption(part: ChartPartData): KumoChartOption {
  const equity = part.series[0]?.data ?? [];
  const dd =
    part.series.find((s) => /drawdown|dd/i.test(s.name))?.data ?? drawdownsFromEquity(equity);
  const categories = cats(part).slice(0, Math.max(equity.length, dd.length));
  return {
    legend: { data: ["Equity", "Drawdown"], bottom: 0, left: 0 },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    grid: [
      { left: 48, right: 16, top: 24, height: "42%" },
      { left: 48, right: 16, top: "58%", height: "28%" }
    ],
    xAxis: [
      { type: "category", data: categories, gridIndex: 0, show: false },
      { type: "category", data: categories, gridIndex: 1 }
    ],
    yAxis: [
      { type: "value", gridIndex: 0, scale: true },
      {
        type: "value",
        gridIndex: 1,
        axisLabel: { formatter: (v: number) => `${(v * 100).toFixed(0)}%` }
      }
    ],
    series: [
      {
        name: "Equity",
        type: "line",
        showSymbol: false,
        data: equity,
        xAxisIndex: 0,
        yAxisIndex: 0
      },
      {
        name: "Drawdown",
        type: "line",
        showSymbol: false,
        areaStyle: {},
        data: dd,
        xAxisIndex: 1,
        yAxisIndex: 1
      }
    ]
  };
}

function bulletOption(part: ChartPartData): KumoChartOption {
  const actual = part.series[0]?.data[0] ?? 0;
  const target =
    part.series.find((s) => /target|目標|budget/i.test(s.name))?.data[0] ??
    part.series[1]?.data[0] ??
    actual * 1.2;
  const lo = Math.min(0, actual, target);
  const hi = Math.max(0, actual, target);
  const pad = Math.max(Math.abs(hi - lo), Math.abs(actual), Math.abs(target), 1) * 0.12;
  // 意味のない枠バーは置かない。範囲は数値軸、比較は実績バーと目標印だけ。
  return {
    grid: { left: 80, right: 24, top: 24, bottom: 28, containLabel: true },
    legend: { data: ["実績", "目標"] },
    xAxis: {
      type: "value",
      min: lo - (lo < 0 ? pad : 0),
      max: hi + pad,
      axisLabel: { formatter: (v: number) => formatChartValue(v) }
    },
    yAxis: { type: "category", data: [part.series[0]?.name ?? part.title ?? "実績"] },
    series: [
      {
        name: "実績",
        type: "bar",
        data: [actual],
        barWidth: 14,
        itemStyle: { color: catColor(0) },
        z: 2
      },
      {
        name: "目標",
        type: "scatter",
        symbol: "rect",
        symbolSize: [4, 22],
        data: [target],
        itemStyle: { color: catColor(1) },
        z: 3
      }
    ]
  };
}

function tornadoOption(part: ChartPartData): KumoChartOption {
  const categories = cats(part);
  const values = part.series[0]?.data ?? [];
  const pairs = categories
    .map((name, i) => ({ name, value: values[i] ?? 0 }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return option({
    grid: { left: 4, right: 16, top: 12, bottom: 36, containLabel: true },
    xAxis: { type: "value" },
    yAxis: { type: "category", data: pairs.map((p) => p.name).reverse() },
    series: [
      {
        type: "bar",
        data: pairs.map((p) => p.value).reverse(),
        itemStyle: {
          color: (params: { value: number }) =>
            params.value >= 0 ? catColor(0) : catColor(1)
        }
      }
    ]
  });
}

function heikinAshiOption(part: ChartPartData): KumoChartOption {
  const { categories, rows } = ohlcRows(part);
  if (!rows.length) return candlestickOption(part);
  const ha: number[][] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const o = row[0]!;
    const c = row[1]!;
    const l = row[2]!;
    const h = row[3]!;
    const haClose = (o + c + l + h) / 4;
    const prev = ha[i - 1];
    const haOpen = i === 0 || !prev ? (o + c) / 2 : (prev[0]! + prev[1]!) / 2;
    const haHigh = Math.max(h, haOpen, haClose);
    const haLow = Math.min(l, haOpen, haClose);
    ha.push([haOpen, haClose, haLow, haHigh]);
  }
  return {
    grid: { left: 4, right: 16, top: 12, bottom: 36, containLabel: true },
    xAxis: { type: "category", data: categories },
    yAxis: { type: "value", scale: true },
    series: [{ type: "candlestick", data: ha }]
  };
}

function renkoOption(part: ChartPartData): KumoChartOption {
  const closes =
    seriesByName(part, "close", "終値", "c") ?? part.series[0]?.data ?? [];
  if (closes.length < 2) return cartesian(part, "bar");
  const span = Math.max(...closes) - Math.min(...closes);
  const brick =
    seriesByName(part, "brick", "size")?.[0] ??
    Math.max(span / 12, Math.abs(closes[closes.length - 1]! - closes[0]!) / 20, 1e-6);
  const bricks: { dir: 1 | -1; price: number }[] = [];
  let ref = closes[0]!;
  for (let i = 1; i < closes.length; i += 1) {
    let p = closes[i]!;
    while (p - ref >= brick) {
      ref += brick;
      bricks.push({ dir: 1, price: ref });
    }
    while (ref - p >= brick) {
      ref -= brick;
      bricks.push({ dir: -1, price: ref });
    }
  }
  if (!bricks.length) return cartesian(part, "bar");
  return {
    grid: { left: 4, right: 16, top: 12, bottom: 36, containLabel: true },
    xAxis: { type: "category", data: bricks.map((_, i) => String(i + 1)) },
    yAxis: { type: "value", scale: true },
    series: [
      {
        type: "candlestick",
        data: bricks.map((b) => {
          const open = b.dir > 0 ? b.price - brick : b.price + brick;
          const close = b.price;
          return [open, close, Math.min(open, close), Math.max(open, close)];
        })
      }
    ]
  };
}

function pointFigureOption(part: ChartPartData): KumoChartOption {
  const closes = part.series[0]?.data ?? [];
  if (closes.length < 2) return cartesian(part, "scatter");
  const box =
    seriesByName(part, "box", "size")?.[0] ??
    Math.max((Math.max(...closes) - Math.min(...closes)) / 15, 1e-6);
  const cols: { x: number; y: number; sym: "X" | "O" }[] = [];
  let col = 0;
  let dir: 1 | -1 = closes[1]! >= closes[0]! ? 1 : -1;
  let ref = closes[0]!;
  for (let i = 1; i < closes.length; i += 1) {
    const p = closes[i]!;
    if (dir > 0) {
      while (p - ref >= box) {
        ref += box;
        cols.push({ x: col, y: ref, sym: "X" });
      }
      if (ref - p >= 3 * box) {
        dir = -1;
        col += 1;
        while (ref - p >= box) {
          ref -= box;
          cols.push({ x: col, y: ref, sym: "O" });
        }
      }
    } else {
      while (ref - p >= box) {
        ref -= box;
        cols.push({ x: col, y: ref, sym: "O" });
      }
      if (p - ref >= 3 * box) {
        dir = 1;
        col += 1;
        while (p - ref >= box) {
          ref += box;
          cols.push({ x: col, y: ref, sym: "X" });
        }
      }
    }
  }
  return {
    grid: { left: 4, right: 16, top: 12, bottom: 36, containLabel: true },
    xAxis: { type: "value", min: 0, max: Math.max(1, col + 1) },
    yAxis: { type: "value", scale: true },
    series: [
      {
        type: "scatter",
        symbolSize: 14,
        data: cols.map((c) => ({
          value: [c.x, c.y],
          symbol: c.sym === "X" ? "path://M0,0 L10,10 M10,0 L0,10" : "circle",
          itemStyle: {
            color: c.sym === "X" ? catColor(0) : catColor(1)
          }
        }))
      }
    ]
  };
}

function volumeProfileOption(part: ChartPartData): KumoChartOption {
  const prices = seriesByName(part, "price", "close", "p") ?? part.series[0]?.data ?? [];
  const vols = seriesByName(part, "volume", "vol", "v") ?? part.series[1]?.data;
  const bins = 12;
  if (prices.length < 2) return cartesian(part, "bar", { horizontal: true });
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const width = (hi - lo) / bins || 1;
  const counts = Array.from({ length: bins }, () => 0);
  for (let i = 0; i < prices.length; i += 1) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((prices[i]! - lo) / width)));
    counts[idx]! += vols?.[i] ?? 1;
  }
  const labels = counts.map((_, i) => (lo + (i + 0.5) * width).toFixed(2));
  return {
    grid: { left: 4, right: 16, top: 12, bottom: 36, containLabel: true },
    xAxis: { type: "value" },
    yAxis: { type: "category", data: labels },
    series: [{ type: "bar", data: counts, name: "Volume" }]
  };
}

function histogramOption(part: ChartPartData): KumoChartOption {
  const raw = part.series[0]?.data ?? [];
  if (part.categories?.length && raw.length === part.categories.length) {
    return cartesian(part, "bar");
  }
  const bins = Math.min(20, Math.max(5, Math.ceil(Math.sqrt(raw.length))));
  if (raw.length < 2) return cartesian(part, "bar");
  const lo = Math.min(...raw);
  const hi = Math.max(...raw);
  const width = (hi - lo) / bins || 1;
  const counts = Array.from({ length: bins }, () => 0);
  for (const v of raw) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / width)));
    counts[idx]! += 1;
  }
  const labels = counts.map((_, i) => `${(lo + i * width).toFixed(1)}`);
  return {
    grid: { left: 4, right: 16, top: 12, bottom: 36, containLabel: true },
    xAxis: { type: "category", data: labels },
    yAxis: { type: "value" },
    series: [{ type: "bar", name: part.series[0]?.name ?? "度数", data: counts, barCategoryGap: "5%" }]
  };
}

function kde(xs: number[], grid: number[]): number[] {
  if (!xs.length) return grid.map(() => 0);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, xs.length - 1);
  const std = Math.sqrt(variance) || 1;
  const h = 1.06 * std * xs.length ** (-1 / 5) || 1;
  const inv = 1 / (xs.length * h * Math.sqrt(2 * Math.PI));
  return grid.map((x) => {
    let s = 0;
    for (const v of xs) {
      const z = (x - v) / h;
      s += Math.exp(-0.5 * z * z);
    }
    return s * inv;
  });
}

function densityOption(part: ChartPartData): KumoChartOption {
  const raw = part.series[0]?.data ?? [];
  if (part.categories?.length && raw.length === part.categories.length) {
    return cartesian(part, "line", { area: true });
  }
  if (raw.length < 2) return cartesian(part, "line", { area: true });
  const lo = Math.min(...raw);
  const hi = Math.max(...raw);
  const grid = Array.from({ length: 48 }, (_, i) => lo + ((hi - lo) * i) / 47);
  const dens = kde(raw, grid);
  return {
    grid: { left: 4, right: 16, top: 12, bottom: 36, containLabel: true },
    xAxis: { type: "value" },
    yAxis: { type: "value" },
    series: [
      {
        type: "line",
        showSymbol: false,
        areaStyle: {},
        data: grid.map((x, i) => [x, dens[i]!]),
        name: part.series[0]?.name ?? "密度"
      }
    ]
  };
}

function ecdfOption(part: ChartPartData): KumoChartOption {
  const raw = [...(part.series[0]?.data ?? [])].sort((a, b) => a - b);
  if (raw.length < 1) return cartesian(part, "line", { step: "end" });
  const n = raw.length;
  const points = raw.flatMap((x, i) => [
    [x, i / n],
    [x, (i + 1) / n]
  ]);
  return {
    grid: { left: 4, right: 16, top: 12, bottom: 36, containLabel: true },
    xAxis: { type: "value" },
    yAxis: { type: "value", min: 0, max: 1 },
    series: [
      {
        type: "line",
        showSymbol: false,
        step: "end",
        data: points,
        name: "ECDF"
      }
    ]
  };
}

function violinOption(part: ChartPartData): KumoChartOption {
  // 群ごと: series[i] が生データ。KDE を左右対称に area で近似（カテゴリ位置オフセット）。
  if (part.series.length === 1 && (part.categories?.length ?? 0) === part.series[0]!.data.length) {
    return boxplotOption(part);
  }
  const groups = part.series.length ? part.series : [{ name: "all", data: part.series[0]?.data ?? [] }];
  const seriesOut: object[] = [];
  groups.forEach((g, gi) => {
    const xs = g.data;
    if (xs.length < 2) return;
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    const grid = Array.from({ length: 24 }, (_, i) => lo + ((hi - lo) * i) / 23);
    const dens = kde(xs, grid);
    const maxD = Math.max(...dens, 1e-9);
    const center = gi;
    const width = 0.35;
    const left = grid.map((y, i) => [center - (dens[i]! / maxD) * width, y]);
    const right = grid.map((y, i) => [center + (dens[i]! / maxD) * width, y]);
    const poly = [...left, ...right.reverse()];
    seriesOut.push({
      name: g.name,
      type: "custom",
      renderItem: (
        _p: unknown,
        api: { coord: (v: number[]) => number[] }
      ) => {
        const points = poly.map((pt) => api.coord(pt));
        return {
          type: "polygon",
          shape: { points },
          style: {
            fill: catColor(gi),
            opacity: 0.45,
            stroke: catColor(gi)
          }
        };
      },
      data: [0],
      clip: true
    });
  });
  if (!seriesOut.length) return boxplotOption(part);
  return option({
    grid: { left: 4, right: 16, top: 12, bottom: 36, containLabel: true },
    xAxis: {
      type: "value",
      min: -0.5,
      max: groups.length - 0.5,
      axisLabel: {
        formatter: (v: number) => groups[Math.round(v)]?.name ?? ""
      }
    },
    yAxis: { type: "value", scale: true },
    series: seriesOut
  });
}

function invNormApprox(p: number): number {
  // Abramowitz & Stegun 近似
  const a = [2.515517, 0.802853, 0.010328];
  const b = [1.432788, 0.189269, 0.001308];
  const clamped = Math.min(0.999, Math.max(0.001, p));
  const t = Math.sqrt(-2 * Math.log(clamped < 0.5 ? clamped : 1 - clamped));
  const num = a[0]! + a[1]! * t + a[2]! * t * t;
  const den = 1 + b[0]! * t + b[1]! * t * t + b[2]! * t * t * t;
  const z = t - num / den;
  return clamped < 0.5 ? -z : z;
}

function qqOption(part: ChartPartData): KumoChartOption {
  const raw = [...(part.series[0]?.data ?? [])].sort((a, b) => a - b);
  if (raw.length < 2) return cartesian(part, "scatter");
  const n = raw.length;
  const points = raw.map((y, i) => {
    const p = (i + 0.5) / n;
    return [invNormApprox(p), y];
  });
  const lo = Math.min(...points.map((p) => p[0]!), ...points.map((p) => p[1]!));
  const hi = Math.max(...points.map((p) => p[0]!), ...points.map((p) => p[1]!));
  return {
    grid: { left: 4, right: 16, top: 12, bottom: 36, containLabel: true },
    xAxis: { type: "value", name: "理論分位" },
    yAxis: { type: "value", name: "標本分位" },
    series: [
      { type: "scatter", data: points, name: "QQ", symbolSize: 8 },
      {
        type: "line",
        showSymbol: false,
        data: [
          [lo, lo],
          [hi, hi]
        ],
        lineStyle: { type: "dashed" },
        name: "y=x"
      }
    ]
  };
}

function errorbarOption(part: ChartPartData): KumoChartOption {
  const categories = cats(part);
  const s = part.series[0];
  if (!s) return cartesian(part, "bar");
  const lows = s.ciLow ?? s.data.map((v, i) => v - (s.errors?.[i] ?? 0));
  const highs = s.ciHigh ?? s.data.map((v, i) => v + (s.errors?.[i] ?? 0));
  return option({
    grid: { left: 4, right: 16, top: 12, bottom: 36, containLabel: true },
    xAxis: { type: "category", data: categories.slice(0, s.data.length) },
    yAxis: { type: "value" },
    series: [
      { type: "bar", name: s.name, data: s.data },
      {
        type: "custom",
        name: "CI",
        data: s.data.map((v, i) => [i, lows[i] ?? v, highs[i] ?? v]),
        renderItem: (
          _p: unknown,
          api: { value: (i: number) => number; coord: (v: number[]) => number[]; size: (v: number[]) => number[] }
        ) => {
          const x = api.value(0);
          const low = api.coord([x, api.value(1)]);
          const high = api.coord([x, api.value(2)]);
          const half = api.size([1, 0])[0]! * 0.2;
          const stroke = catColor(1);
          return {
            type: "group",
            children: [
              {
                type: "line",
                shape: { x1: low[0], y1: low[1], x2: high[0], y2: high[1] },
                style: { stroke, lineWidth: 1.5 }
              },
              {
                type: "line",
                shape: { x1: low[0]! - half, y1: low[1], x2: low[0]! + half, y2: low[1] },
                style: { stroke, lineWidth: 1.5 }
              },
              {
                type: "line",
                shape: { x1: high[0]! - half, y1: high[1], x2: high[0]! + half, y2: high[1] },
                style: { stroke, lineWidth: 1.5 }
              }
            ]
          };
        },
        z: 3
      }
    ]
  });
}

function forestOption(part: ChartPartData): KumoChartOption {
  const categories = cats(part);
  const s = part.series[0];
  if (!s) return cartesian(part, "scatter", { horizontal: true });
  const lows = s.ciLow ?? s.data.map((v, i) => v - (s.errors?.[i] ?? 0));
  const highs = s.ciHigh ?? s.data.map((v, i) => v + (s.errors?.[i] ?? 0));
  const n = s.data.length;
  return option({
    grid: { left: 4, right: 16, top: 12, bottom: 36, containLabel: true },
    xAxis: { type: "value" },
    yAxis: { type: "category", data: categories.slice(0, n).reverse() },
    series: [
      {
        type: "custom",
        data: s.data.map((v, i) => [v, lows[i] ?? v, highs[i] ?? v, n - 1 - i]),
        renderItem: (
          _p: unknown,
          api: { value: (i: number) => number; coord: (v: number[]) => number[] }
        ) => {
          const effect = api.value(0);
          const low = api.value(1);
          const high = api.value(2);
          const yCat = api.value(3);
          const pLow = api.coord([low, yCat]);
          const pHigh = api.coord([high, yCat]);
          const pMid = api.coord([effect, yCat]);
          const stroke = catColor(0);
          return {
            type: "group",
            children: [
              {
                type: "line",
                shape: { x1: pLow[0], y1: pLow[1], x2: pHigh[0], y2: pHigh[1] },
                style: { stroke, lineWidth: 2 }
              },
              {
                type: "circle",
                shape: { cx: pMid[0], cy: pMid[1], r: 4 },
                style: { fill: stroke }
              }
            ]
          };
        }
      }
    ]
  });
}

function hexbinOption(part: ChartPartData): KumoChartOption {
  // 2系列を x,y とみなし格子ヒートマップで近似
  const xs = part.series[0]?.data ?? [];
  const ys = part.series[1]?.data ?? part.series[0]?.data ?? [];
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return heatmapOption(part);
  const bins = 10;
  const minX = Math.min(...xs.slice(0, n));
  const maxX = Math.max(...xs.slice(0, n));
  const minY = Math.min(...ys.slice(0, n));
  const maxY = Math.max(...ys.slice(0, n));
  const wX = (maxX - minX) / bins || 1;
  const wY = (maxY - minY) / bins || 1;
  const grid = Array.from({ length: bins * bins }, () => 0);
  for (let i = 0; i < n; i += 1) {
    const xi = Math.min(bins - 1, Math.max(0, Math.floor((xs[i]! - minX) / wX)));
    const yi = Math.min(bins - 1, Math.max(0, Math.floor((ys[i]! - minY) / wY)));
    grid[yi * bins + xi]! += 1;
  }
  const points: [number, number, number][] = [];
  let max = 1;
  for (let yi = 0; yi < bins; yi += 1) {
    for (let xi = 0; xi < bins; xi += 1) {
      const v = grid[yi * bins + xi]!;
      points.push([xi, yi, v]);
      max = Math.max(max, v);
    }
  }
  return {
    grid: { left: 48, right: 16, top: 12, bottom: 36, containLabel: true },
    xAxis: { type: "category", data: Array.from({ length: bins }, (_, i) => String(i)) },
    yAxis: { type: "category", data: Array.from({ length: bins }, (_, i) => String(i)) },
    visualMap: { min: 0, max, calculable: true, orient: "horizontal", left: "center", bottom: 0 },
    series: [{ type: "heatmap", data: points }]
  };
}

function contourOption(part: ChartPartData): KumoChartOption {
  // 等高線はヒートマップ＋主要レベル線で近似
  const heat = heatmapOption(part);
  return heat;
}

function ridgelineOption(part: ChartPartData): KumoChartOption {
  const groups = part.series;
  if (!groups.length) return densityOption(part);
  const offset = 1;
  const series = groups.map((g, gi) => {
    const xs = g.data;
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    const grid = Array.from({ length: 32 }, (_, i) => lo + ((hi - lo) * i) / 31 || lo);
    const dens = kde(xs.length >= 2 ? xs : [lo, hi], grid);
    const maxD = Math.max(...dens, 1e-9);
    return {
      name: g.name,
      type: "line" as const,
      showSymbol: false,
      areaStyle: { opacity: 0.55 },
      lineStyle: { width: 1 },
      data: grid.map((x, i) => [x, (dens[i]! / maxD) * 0.9 + gi * offset]),
      z: groups.length - gi
    };
  });
  return {
    legend: { data: groups.map((g) => g.name), bottom: 0, left: 0 },
    grid: { left: 4, right: 16, top: 12, bottom: 48, containLabel: true },
    xAxis: { type: "value" },
    yAxis: {
      type: "value",
      min: 0,
      max: groups.length * offset,
      axisLabel: {
        formatter: (v: number) => {
          const i = Math.round(v / offset);
          return groups[i]?.name ?? "";
        }
      }
    },
    series
  };
}

function paretoOption(part: ChartPartData): KumoChartOption {
  const categories = cats(part);
  const values = [...(part.series[0]?.data ?? [])];
  const pairs = categories
    .map((name, i) => ({ name, value: values[i] ?? 0 }))
    .sort((a, b) => b.value - a.value);
  const total = pairs.reduce((a, p) => a + Math.max(0, p.value), 0) || 1;
  let cum = 0;
  const cumPct = pairs.map((p) => {
    cum += Math.max(0, p.value);
    return (cum / total) * 100;
  });
  return {
    legend: { data: ["度数", "累積%"], bottom: 0, left: 0 },
    grid: { left: 4, right: 40, top: 12, bottom: 36, containLabel: true },
    xAxis: { type: "category", data: pairs.map((p) => p.name) },
    yAxis: [
      { type: "value", name: "度数" },
      { type: "value", name: "%", min: 0, max: 100, axisLabel: { formatter: "{value}%" } }
    ],
    series: [
      { name: "度数", type: "bar", data: pairs.map((p) => p.value) },
      {
        name: "累積%",
        type: "line",
        yAxisIndex: 1,
        data: cumPct,
        showSymbol: true
      }
    ]
  };
}

export type ChartSurface = "default" | "dashboard";

/** 軸ホバーで値を出す系（line の showSymbol:false でも必須）。 */
const AXIS_TOOLTIP_TYPES = new Set<ChartType>([
  "line",
  "area",
  "bar",
  "bar_horizontal",
  "scatter",
  "waterfall",
  "volume",
  "drawdown",
  "equity_drawdown",
  "histogram",
  "density",
  "ecdf",
  "ridgeline",
  "pareto",
  "candlestick",
  "ohlc",
  "heikin_ashi",
  "renko",
  "boxplot",
  "errorbar",
  "forest",
  "bullet",
  "tornado",
  "volume_profile",
  "heatmap",
  "hexbin",
  "contour",
  "qq"
]);

export function formatChartValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 4 }).format(value);
  }
  if (Array.isArray(value)) return value.map(formatChartValue).join(", ");
  if (typeof value === "object" && value !== null && "value" in value) {
    return formatChartValue((value as { value: unknown }).value);
  }
  return String(value);
}

export function chartTooltipTrigger(chartType: ChartType): "axis" | "item" {
  return AXIS_TOOLTIP_TYPES.has(chartType) ? "axis" : "item";
}

/** スクリーンリーダー用の表データ（WCAG 1.1.1 代替テキスト）。 */
export function chartDataTable(part: ChartPartData): {
  caption: string;
  columns: string[];
  rows: string[][];
} {
  const categories = cats(part);
  const caption = part.title?.trim() || "チャート";
  if (!part.series.length) {
    return { caption, columns: ["項目", "値"], rows: [] };
  }
  const columns = ["項目", ...part.series.map((s) => s.name)];
  const rowCount = Math.max(categories.length, ...part.series.map((s) => s.data.length), 0);
  const rows = Array.from({ length: rowCount }, (_, i) => [
    categories[i] ?? String(i + 1),
    ...part.series.map((s) => formatChartValue(s.data[i]))
  ]);
  return { caption, columns, rows };
}

function chartAriaDescription(part: ChartPartData): string {
  const table = chartDataTable(part);
  if (!table.rows.length) return `${table.caption}。データなし。`;
  const preview = table.rows
    .slice(0, 8)
    .map((row) => row.join(": "))
    .join("。");
  const more = table.rows.length > 8 ? ` ほか${table.rows.length - 8}行。` : "";
  return `${table.caption}。系列${part.series.map((s) => s.name).join("、")}。${preview}。${more}`;
}

/**
 * ホバー値・キーボード・色以外の手がかり（decal）・コントラストのある tooltip。
 * Kumo Chart は tooltip 未指定時に何も足さない。dangerousHtmlFormatter 以外の formatter は潰される。
 */
function withChartA11y(
  raw: KumoChartOption,
  part: ChartPartData,
  chartType: ChartType,
  reduceMotion: boolean
): KumoChartOption {
  const base = raw as Record<string, unknown>;
  const trigger = chartTooltipTrigger(chartType);
  const existing =
    base.tooltip && typeof base.tooltip === "object" && !Array.isArray(base.tooltip)
      ? (base.tooltip as Record<string, unknown>)
      : {};
  const resolvedTrigger =
    existing.trigger === "axis" || existing.trigger === "item"
      ? existing.trigger
      : trigger;
  const tooltip = {
    backgroundColor: paletteDark ? "#1c1c1c" : "#ffffff",
    borderColor: paletteDark ? "#3a3a3a" : "#c8c8c8",
    borderWidth: 1,
    padding: [8, 10],
    textStyle: {
      color: paletteDark ? "#f2f2f2" : "#1a1a1a",
      fontSize: 12,
      fontWeight: 500
    },
    axisPointer:
      resolvedTrigger === "axis"
        ? {
            type:
              chartType === "bar" || chartType === "bar_horizontal" || chartType === "waterfall"
                ? "shadow"
                : "line",
            snap: true,
            label: {
              show: true,
              backgroundColor: paletteDark ? "#2a2a2a" : "#ffffff",
              color: paletteDark ? "#f2f2f2" : "#1a1a1a"
            }
          }
        : undefined,
    ...existing,
    show: true,
    trigger: resolvedTrigger,
    triggerOn: "mousemove|click|mousewheel",
    appendTo: "body",
    confine: false,
    enterable: true,
    extraCssText: paletteDark
      ? "z-index:10000;box-shadow:0 8px 24px rgba(0,0,0,.45);border-radius:6px;pointer-events:auto;"
      : "z-index:10000;box-shadow:0 4px 16px rgba(0,0,0,.14);border-radius:6px;pointer-events:auto;",
    valueFormatter: (value: unknown) => formatChartValue(value)
  };
  return option({
    ...base,
    animation: reduceMotion ? false : base.animation !== false,
    animationDuration: reduceMotion ? 0 : (base.animationDuration as number | undefined),
    tooltip,
    aria: {
      ...(typeof base.aria === "object" && base.aria ? base.aria : {}),
      enabled: true,
      decal: { show: true },
      label: {
        description: chartAriaDescription(part)
      }
    }
  });
}

/** dashboard 面: chrome を削り、入場アニメだけ残す（data-ink）。 */
function withDashboardSurface(raw: KumoChartOption, reduceMotion: boolean): KumoChartOption {
  const seriesCount = Array.isArray(raw.series) ? raw.series.length : raw.series ? 1 : 0;
  const base = raw as Record<string, unknown>;
  const grid = (base.grid && !Array.isArray(base.grid) ? base.grid : {}) as Record<string, unknown>;
  return option({
    ...base,
    animation: !reduceMotion,
    animationDuration: reduceMotion ? 0 : 650,
    animationEasing: "cubicOut",
    animationDelay: reduceMotion ? 0 : (idx: number) => Math.min(idx, 8) * 35,
    legend:
      seriesCount <= 1
        ? undefined
        : {
            ...(typeof base.legend === "object" && base.legend ? base.legend : {}),
            bottom: 0,
            left: 0,
            itemWidth: 10,
            itemHeight: 8,
            textStyle: {
              fontSize: 11,
              color: paletteDark ? "rgba(255,255,255,0.72)" : "rgba(0,0,0,0.65)"
            }
          },
    grid: Array.isArray(base.grid)
      ? base.grid
      : {
          left: 2,
          right: 8,
          top: 10,
          bottom: seriesCount <= 1 ? 8 : 28,
          containLabel: true,
          ...grid
        },
    xAxis: muteAxis(base.xAxis),
    yAxis: muteAxis(base.yAxis)
  });
}

function muteAxis(axis: unknown): unknown {
  if (!axis) return axis;
  if (Array.isArray(axis)) return axis.map((a) => muteAxis(a));
  if (typeof axis !== "object") return axis;
  const a = axis as Record<string, unknown>;
  const labelColor = paletteDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.45)";
  const splitColor = paletteDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
  return {
    ...a,
    axisLine: { show: false, ...(typeof a.axisLine === "object" ? a.axisLine : {}) },
    axisTick: { show: false },
    axisLabel: {
      color: labelColor,
      ...(typeof a.axisLabel === "object" && a.axisLabel ? a.axisLabel : {})
    },
    splitLine: {
      show: true,
      lineStyle: { color: splitColor, opacity: 1 },
      ...(typeof a.splitLine === "object" ? a.splitLine : {})
    }
  };
}

export function buildChartOption(
  part: ChartPartData,
  surface: ChartSurface = "default",
  options: { reduceMotion?: boolean; isDarkMode?: boolean } = {}
): KumoChartOption {
  const reduceMotion = options.reduceMotion === true;
  paletteDark = options.isDarkMode === true;
  const type = isChartType(part.chartType) ? part.chartType : "line";
  let raw: KumoChartOption;
  switch (type) {
    case "line":
      raw = cartesian(part, "line");
      break;
    case "area":
      raw = cartesian(part, "line", { area: true });
      break;
    case "bar":
      raw = cartesian(part, "bar");
      break;
    case "bar_horizontal":
      raw = cartesian(part, "bar", { horizontal: true });
      break;
    case "pie":
      raw = pieLike(part, "pie");
      break;
    case "donut":
      raw = pieLike(part, "donut");
      break;
    case "coxcomb":
      raw = pieLike(part, "coxcomb");
      break;
    case "scatter":
      raw = cartesian(part, "scatter");
      break;
    case "radar":
      raw = radarOption(part);
      break;
    case "funnel":
      raw = pieLike(part, "funnel");
      break;
    case "gauge":
      raw = gaugeOption(part);
      break;
    case "heatmap":
      raw = heatmapOption(part);
      break;
    case "treemap":
      raw = treeLike(part, "treemap");
      break;
    case "sunburst":
      raw = treeLike(part, "sunburst");
      break;
    case "boxplot":
      raw = boxplotOption(part);
      break;
    case "candlestick":
      raw = candlestickOption(part);
      break;
    case "sankey":
      raw = flowOption(part, "sankey");
      break;
    case "graph":
      raw = flowOption(part, "graph");
      break;
    case "waterfall":
      raw = waterfallOption(part);
      break;
    case "ohlc":
      raw = ohlcOption(part);
      break;
    case "volume":
      raw = volumeOption(part);
      break;
    case "drawdown":
      raw = drawdownOption(part);
      break;
    case "equity_drawdown":
      raw = equityDrawdownOption(part);
      break;
    case "bullet":
      raw = bulletOption(part);
      break;
    case "tornado":
      raw = tornadoOption(part);
      break;
    case "heikin_ashi":
      raw = heikinAshiOption(part);
      break;
    case "renko":
      raw = renkoOption(part);
      break;
    case "point_figure":
      raw = pointFigureOption(part);
      break;
    case "volume_profile":
      raw = volumeProfileOption(part);
      break;
    case "histogram":
      raw = histogramOption(part);
      break;
    case "density":
      raw = densityOption(part);
      break;
    case "ecdf":
      raw = ecdfOption(part);
      break;
    case "violin":
      raw = violinOption(part);
      break;
    case "qq":
      raw = qqOption(part);
      break;
    case "errorbar":
      raw = errorbarOption(part);
      break;
    case "forest":
      raw = forestOption(part);
      break;
    case "hexbin":
      raw = hexbinOption(part);
      break;
    case "contour":
      raw = contourOption(part);
      break;
    case "ridgeline":
      raw = ridgelineOption(part);
      break;
    case "pareto":
      raw = paretoOption(part);
      break;
    default:
      raw = cartesian(part, "line");
  }
  if (surface === "dashboard" && (type === "line" || type === "area")) {
    const series = Array.isArray(raw.series) ? raw.series : raw.series ? [raw.series] : [];
    raw = option({
      ...raw,
      series: series.map((s, i) => {
        if (!s || typeof s !== "object") return s;
        const row = s as Record<string, unknown>;
        if (row.type !== "line") return s;
        return {
          ...row,
          showSymbol: false,
          smooth: 0.15,
          lineStyle: { width: 2, ...(typeof row.lineStyle === "object" ? row.lineStyle : {}) },
          areaStyle: {
            opacity: 0.12,
            ...(typeof row.areaStyle === "object" ? row.areaStyle : {})
          },
          itemStyle: { color: catColor(i) }
        };
      })
    });
  }
  const surfaced = surface === "dashboard" ? withDashboardSurface(raw, reduceMotion) : raw;
  return withChartA11y(surfaced, part, type, reduceMotion);
}

export function chartHeight(chartType: ChartType, span: 1 | 2 = 1): number {
  const tall =
    chartType === "radar" ||
    chartType === "sunburst" ||
    chartType === "treemap" ||
    chartType === "coxcomb" ||
    chartType === "graph" ||
    chartType === "sankey" ||
    chartType === "equity_drawdown" ||
    chartType === "ridgeline" ||
    chartType === "violin";
  if (tall) return span === 2 ? 260 : 240;
  if (chartType === "gauge" || chartType === "bullet") return 200;
  return span === 2 ? 220 : 176;
}
