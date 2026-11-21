/** Controlled dashboard の組立パターン集。契約デモ用。ドメインはマッパ例。 */
import type { UiPart } from "../types";

export type DashboardPattern = {
  id: string;
  label: string;
  part: Extract<UiPart, { kind: "dashboard" }>;
};

const years = Array.from({ length: 12 }, (_, i) => String(i + 1));

/** 年次（第一マッパ例）: KPI + line / bar / 全幅 line */
export const patternYearly: DashboardPattern = {
  id: "yearly",
  label: "年次 · KPI + line / bar / span2 area",
  part: {
    kind: "dashboard",
    title: "年次",
    metrics: [
      { id: "noi", label: "NOI", value: "922,000円" },
      { id: "ads", label: "ADS", value: "1,094,440円" },
      { id: "atcf", label: "ATCF", value: "-172,440円", tone: "negative" },
      { id: "pv", label: "PV", value: "-164,229円", tone: "negative" }
    ],
    widgets: [
      {
        id: "noi",
        span: 1,
        title: "NOI / ADS",
        body: {
          kind: "chart",
          chartType: "line",
          categories: years,
          series: [
            { name: "NOI", data: years.map(() => 922_000) },
            { name: "ADS", data: years.map((_, i) => 1_094_440 + i * 1200) }
          ]
        }
      },
      {
        id: "cf",
        span: 1,
        title: "キャッシュフロー",
        body: {
          kind: "chart",
          chartType: "bar",
          categories: years,
          series: [
            { name: "BTCF", data: years.map((_, i) => -80_000 - i * 4_000) },
            { name: "ATCF", data: years.map((_, i) => -172_440 - i * 6_000) }
          ]
        }
      },
      {
        id: "pv",
        span: 2,
        title: "現在価値",
        body: {
          kind: "chart",
          chartType: "area",
          categories: years,
          series: [{ name: "PV", data: years.map((_, i) => -164_000 + i * 7_000) }]
        }
      }
    ]
  }
};

/** キャンペーン: scatter + funnel + 全幅表 */
export const patternCampaign: DashboardPattern = {
  id: "campaign",
  label: "キャンペーン · scatter / funnel / span2 表",
  part: {
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
            { name: "spend", data: [12, 28, 35, 48, 55, 62, 71, 80] },
            { name: "sales", data: [40, 72, 95, 110, 150, 168, 190, 220] }
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
            { id: "EU-01", cells: { id: "EU-01", region: "Europe", roi: 361 } },
            { id: "AP-01", cells: { id: "AP-01", region: "Asia Pacific", roi: 298 } }
          ]
        }
      }
    ]
  }
};

/** 感度: tornado + waterfall + bullet */
export const patternSensitivity: DashboardPattern = {
  id: "sensitivity",
  label: "感度 · tornado / waterfall / bullet",
  part: {
    kind: "dashboard",
    title: "感度",
    metrics: [
      { id: "base", label: "基準 NPV", value: "¥48.2M" },
      { id: "upside", label: "上振れ", value: "+¥12.1M", tone: "positive" },
      { id: "down", label: "下振れ", value: "−¥9.4M", tone: "negative" },
      { id: "drivers", label: "主要因", value: "3" }
    ],
    widgets: [
      {
        id: "tornado",
        span: 1,
        title: "Tornado",
        body: {
          kind: "chart",
          chartType: "tornado",
          categories: ["賃料", "空室率", "金利", "Capex", "税率"],
          series: [{ name: "ΔNPV", data: [8.2, -5.1, -3.4, 2.1, -1.2] }]
        }
      },
      {
        id: "waterfall",
        span: 1,
        title: "Waterfall",
        body: {
          kind: "chart",
          chartType: "waterfall",
          categories: ["基準", "賃料", "空室", "金利", "結果"],
          // [開始合計, 増減…, 終了合計] — 中間はデルタ
          series: [{ name: "NPV", data: [40, 18, -7, -5, 46] }]
        }
      },
      {
        id: "bullet",
        span: 2,
        title: "目標対比",
        body: {
          kind: "chart",
          chartType: "bullet",
          series: [
            { name: "実績", data: [82] },
            { name: "target", data: [100] }
          ]
        }
      }
    ]
  }
};

/** 構成: donut + coxcomb + metrics セル */
export const patternMix: DashboardPattern = {
  id: "mix",
  label: "構成 · donut / coxcomb / metrics",
  part: {
    kind: "dashboard",
    title: "ポートフォリオ構成",
    metrics: [
      { id: "assets", label: "物件数", value: "18" },
      { id: "gmv", label: "資産額", value: "¥6.4B" },
      { id: "occ", label: "稼働率", value: "94%", tone: "positive" },
      { id: "wale", label: "WALE", value: "4.2年" }
    ],
    widgets: [
      {
        id: "donut",
        span: 1,
        title: "用途",
        body: {
          kind: "chart",
          chartType: "donut",
          categories: ["住居", "店舗", "事務所", "その他"],
          series: [{ name: "share", data: [52, 22, 18, 8] }]
        }
      },
      {
        id: "coxcomb",
        span: 1,
        title: "エリア強度",
        body: {
          kind: "chart",
          chartType: "coxcomb",
          categories: ["都心", "城東", "城西", "城南", "城北"],
          series: [{ name: "intensity", data: [9, 6, 7, 5, 4] }]
        }
      },
      {
        id: "extra",
        span: 2,
        title: "補足指標",
        body: {
          kind: "metrics",
          items: [
            { id: "ltv", label: "LTV", value: "58%" },
            { id: "dscr", label: "DSCR", value: "1.32", tone: "positive" },
            { id: "cap", label: "平均キャップ", value: "5.1%" },
            { id: "debt", label: "残債", value: "¥2.1B" }
          ]
        }
      }
    ]
  }
};

/** 統計: histogram + boxplot + ridgeline */
export const patternStats: DashboardPattern = {
  id: "stats",
  label: "統計 · histogram / boxplot / ridgeline",
  part: {
    kind: "dashboard",
    title: "分布",
    metrics: [
      { id: "n", label: "n", value: "240" },
      { id: "median", label: "中央値", value: "¥218k" },
      { id: "p90", label: "P90", value: "¥410k" },
      { id: "skew", label: "歪度", value: "0.42" }
    ],
    widgets: [
      {
        id: "hist",
        span: 1,
        title: "賃料ヒストグラム",
        body: {
          kind: "chart",
          chartType: "histogram",
          series: [
            {
              name: "rent",
              data: [
                120, 140, 150, 160, 160, 170, 180, 190, 200, 210, 210, 220, 230, 240, 250, 280, 300,
                320, 350, 400
              ]
            }
          ]
        }
      },
      {
        id: "box",
        span: 1,
        title: "エリア別箱ひげ",
        body: {
          kind: "chart",
          chartType: "boxplot",
          categories: ["A", "B", "C"],
          series: [
            { name: "y1", data: [100, 120, 110] },
            { name: "y2", data: [150, 180, 160] },
            { name: "y3", data: [200, 240, 210] },
            { name: "y4", data: [260, 300, 280] },
            { name: "y5", data: [320, 380, 340] }
          ]
        }
      },
      {
        id: "ridge",
        span: 2,
        title: "世代別密度",
        body: {
          kind: "chart",
          chartType: "ridgeline",
          series: [
            { name: "20代", data: [1, 2, 2, 3, 4, 3, 2] },
            { name: "30代", data: [2, 3, 4, 5, 4, 3, 2] },
            { name: "40代", data: [1, 2, 3, 4, 5, 4, 3] }
          ]
        }
      }
    ]
  }
};

export const DASHBOARD_PATTERNS: DashboardPattern[] = [
  patternYearly,
  patternCampaign,
  patternSensitivity,
  patternMix,
  patternStats
];
