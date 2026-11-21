import { describe, expect, it } from "vitest";
import {
  UI_ITEMS_MAX,
  collectUiParts,
  mapRowsToCompareTable,
  mapToolToUiParts,
  mergeUiParts,
  pickSelectionText,
  resolveExclusivePresentSurfaces,
  type UiPart
} from "./uiParts";

describe("mapToolToUiParts web_search", () => {
  it("results を picks にする", () => {
    const parts = mapToolToUiParts("web_search", { query: "x" }, {
      ok: true,
      results: [
        { title: "A", url: "https://a.example/1", snippet: "hello", imageUrl: "https://cdn.example/a.jpg" },
        { title: "B", url: "https://b.example/2", snippet: "world" }
      ]
    });
    expect(parts[0]).toMatchObject({
      kind: "picks",
      sourceTool: "web_search",
      items: [
        {
          id: "https://a.example/1",
          title: "A",
          detail: "hello",
          url: "https://a.example/1",
          imageUrl: "https://cdn.example/a.jpg",
          images: [{ url: "https://cdn.example/a.jpg", role: "hero" }]
        },
        { id: "https://b.example/2", title: "B", detail: "world", url: "https://b.example/2" }
      ]
    });
    expect(parts.map((p) => p.kind)).toEqual(["picks"]);
  });

  it("images 配列を載せる", () => {
    const parts = mapToolToUiParts("web_search", {}, {
      ok: true,
      results: [
        {
          title: "X",
          url: "https://x.example/",
          snippet: "s",
          images: [
            { url: "https://cdn.example/1.jpg" },
            { url: "https://cdn.example/2.jpg" }
          ]
        }
      ]
    });
    expect(parts[0]?.kind).toBe("picks");
    if (parts[0]?.kind !== "picks") return;
    expect(parts[0].items[0]?.images?.map((i) => i.url)).toEqual([
      "https://cdn.example/1.jpg",
      "https://cdn.example/2.jpg"
    ]);
    expect(parts[0].items[0]?.imageUrl).toBe("https://cdn.example/1.jpg");
  });

  it("http と不正 URL を落とす", () => {
    const parts = mapToolToUiParts("web_search", {}, {
      ok: true,
      results: [
        { title: "bad", url: "http://insecure.example/", snippet: "x" },
        { title: "ok", url: "https://secure.example/", snippet: "y" },
        { title: "nope", url: "not-a-url", snippet: "z" }
      ]
    });
    expect(parts[0]?.kind).toBe("picks");
    if (parts[0]?.kind !== "picks") return;
    expect(parts[0].items).toEqual([
      { id: "https://secure.example/", title: "ok", detail: "y", url: "https://secure.example/" }
    ]);
  });

  it("空 results は空", () => {
    expect(mapToolToUiParts("web_search", {}, { ok: true, results: [] })).toEqual([]);
  });

  it("件数上限", () => {
    const results = Array.from({ length: UI_ITEMS_MAX + 5 }, (_, i) => ({
      title: `t${i}`,
      url: `https://ex.example/${i}`,
      snippet: "s"
    }));
    const parts = mapToolToUiParts("web_search", {}, { ok: true, results });
    expect(parts[0]?.kind).toBe("picks");
    if (parts[0]?.kind !== "picks") return;
    expect(parts[0].items).toHaveLength(UI_ITEMS_MAX);
  });
});

describe("mapToolToUiParts browser_fetch", () => {
  it("1件の sources にする", () => {
    const parts = mapToolToUiParts("browser_fetch", { url: "https://docs.example/" }, {
      ok: true,
      result: {
        url: "https://docs.example/",
        finalUrl: "https://docs.example/page",
        markdown: "本文の先頭です。"
      }
    });
    expect(parts).toMatchObject([
      {
        kind: "sources",
        sourceTool: "browser_fetch",
        items: [
          {
            title: "docs.example",
            url: "https://docs.example/page",
            snippet: "本文の先頭です。"
          }
        ]
      }
    ]);
  });

  it("facts があれば fact_rows を sources の前に出す", () => {
    const parts = mapToolToUiParts("browser_fetch", { url: "https://finance.example/nvda" }, {
      ok: true,
      result: {
        url: "https://finance.example/nvda",
        finalUrl: "https://finance.example/nvda",
        title: "NVDA",
        markdown: "Close $213.66"
      },
      facts: [
        { id: "f1", label: "Close $213.66", value: "$213.66", numeric: 213.66, asOf: "2025-10-29" }
      ]
    });
    expect(parts.map((p) => p.kind)).toEqual(["fact_rows", "sources"]);
    expect(parts[0]).toMatchObject({
      kind: "fact_rows",
      sourceTool: "browser_fetch",
      sourceUrl: "https://finance.example/nvda",
      rows: [{ id: "f1", label: "Close $213.66", value: "$213.66", asOf: "2025-10-29" }]
    });
    expect(typeof parts[0]?.producedAt).toBe("number");
  });
});

describe("mergeUiParts job_progress", () => {
  it("後勝ちで1件残す", () => {
    const a: UiPart = {
      kind: "job_progress",
      phases: [{ id: "search", label: "検索", state: "done" }],
      meters: [{ id: "web_search", label: "検索", used: 1, max: 5 }]
    };
    const b: UiPart = {
      kind: "job_progress",
      phases: [{ id: "fetch", label: "ページ", state: "done" }],
      meters: [{ id: "browser_fetch", label: "ページ", used: 1, max: 5 }]
    };
    const merged = mergeUiParts([a, b]);
    expect(merged.filter((p) => p.kind === "job_progress")).toHaveLength(1);
    expect(merged.find((p) => p.kind === "job_progress")).toMatchObject(b);
  });
});

describe("mergeUiParts fact_rows", () => {
  it("複数 fetch の行をマージする", () => {
    const merged = mergeUiParts([
      {
        kind: "fact_rows",
        sourceUrl: "https://a.example/",
        rows: [{ id: "f1", label: "Close", value: "$1", asOf: "2025-10-01" }]
      },
      {
        kind: "fact_rows",
        sourceUrl: "https://b.example/",
        rows: [{ id: "f2", label: "Close", value: "$2", asOf: "2025-10-08" }]
      }
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.kind).toBe("fact_rows");
    if (merged[0]?.kind === "fact_rows") {
      expect(merged[0].rows).toHaveLength(2);
    }
  });
});

describe("mapToolToUiParts read_records", () => {
  it("単一ノートを ledger_figures にする", () => {
    const parts = mapToolToUiParts("read_records", { kind: "note", id: "n1" }, {
      ok: true,
      record: { id: "n1", title: "賃料", body: "", value: 120000 }
    });
    expect(parts).toMatchObject([
      { kind: "ledger_figures", sourceTool: "read_records", items: [{ id: "n1", title: "賃料", value: 120000 }] }
    ]);
  });

  it("一覧は title 付きを載せる", () => {
    const parts = mapToolToUiParts("read_records", { kind: "note" }, {
      ok: true,
      records: [
        { id: "a", title: "甲" },
        { id: "b", title: "乙" }
      ]
    });
    expect(parts).toMatchObject([
      {
        kind: "ledger_figures",
        sourceTool: "read_records",
        items: [
          { id: "a", title: "甲", value: null },
          { id: "b", title: "乙", value: null }
        ]
      }
    ]);
  });

  it("memo 単体は出さない", () => {
    expect(
      mapToolToUiParts("read_records", { kind: "thread_memo", id: "m1" }, {
        ok: true,
        record: { id: "m1", memo_body: "x", version: 1 }
      })
    ).toEqual([]);
  });
});

describe("mapToolToUiParts kanban", () => {
  it("追加結果を kanban_snip にする", () => {
    expect(
      mapToolToUiParts("kanban_add", {}, {
        ok: true,
        accepted: true,
        id: "c1",
        state: "実行中",
        title: "現地確認"
      })
    ).toMatchObject([
      {
        kind: "kanban_snip",
        sourceTool: "kanban_add",
        cards: [{ id: "c1", title: "現地確認", state: "実行中" }]
      }
    ]);
  });
});

describe("dashboard（汎用）", () => {
  it("中立フィクスチャを merge で1枚に保つ", () => {
    const dash = {
      kind: "dashboard" as const,
      title: "Performance overview",
      metrics: [
        { id: "spend", label: "Total Ad Spends", value: "$110.42Mn" },
        { id: "sales", label: "Total Sales", value: "$425.5Mn" },
        { id: "roi", label: "Average ROI%", value: "342%", tone: "positive" as const },
        { id: "campaigns", label: "Active campaigns", value: "12" }
      ],
      widgets: [
        {
          id: "scatter",
          span: 1 as const,
          title: "Ad spends vs Sales",
          body: {
            kind: "chart" as const,
            chartType: "scatter" as const,
            series: [
              { name: "spend", data: [1, 2, 3, 4] },
              { name: "sales", data: [2, 4, 5, 8] }
            ]
          }
        },
        {
          id: "funnel",
          span: 1 as const,
          title: "Campaign funnel",
          body: {
            kind: "chart" as const,
            chartType: "funnel" as const,
            categories: ["Impressions", "Clicks", "Sign-ups", "Purchases"],
            series: [{ name: "funnel", data: [4_200_000, 310_000, 42_000, 9_800] }]
          }
        },
        {
          id: "regions",
          span: 2 as const,
          title: "Regional campaign snapshot",
          body: {
            kind: "compare_table" as const,
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
    const merged = mergeUiParts([
      dash,
      { kind: "chart", chartType: "line", series: [{ name: "x", data: [1, 2] }] }
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.kind).toBe("dashboard");
    if (merged[0]?.kind !== "dashboard") return;
    expect(merged[0].metrics).toHaveLength(4);
    expect(merged[0].widgets).toHaveLength(3);
    expect(merged[0].widgets[2]?.body.kind).toBe("compare_table");
  });
});

describe("mergeUiParts / collectUiParts", () => {
  it("picks を id でデデュペする", () => {
    const merged = mergeUiParts([
      {
        kind: "picks",
        items: [{ id: "https://a.example/", title: "A", url: "https://a.example/" }]
      },
      {
        kind: "picks",
        items: [
          { id: "https://a.example/", title: "A2", url: "https://a.example/" },
          { id: "https://b.example/", title: "B", url: "https://b.example/" }
        ]
      }
    ]);
    expect(merged).toEqual([
      {
        kind: "picks",
        items: [
          { id: "https://a.example/", title: "A", url: "https://a.example/" },
          { id: "https://b.example/", title: "B", url: "https://b.example/" }
        ]
      }
    ]);
  });

  it("sources を url でデデュペする", () => {
    const merged = mergeUiParts([
      {
        kind: "sources",
        items: [{ title: "A", url: "https://a.example/", snippet: "1" }]
      },
      {
        kind: "sources",
        items: [
          { title: "A2", url: "https://a.example/", snippet: "2" },
          { title: "B", url: "https://b.example/", snippet: "3" }
        ]
      }
    ]);
    expect(merged).toEqual([
      {
        kind: "sources",
        items: [
          { title: "A", url: "https://a.example/", snippet: "1" },
          { title: "B", url: "https://b.example/", snippet: "3" }
        ]
      }
    ]);
  });

  it("collect で複数ツールをまとめる", () => {
    const parts = collectUiParts([
      {
        name: "web_search",
        result: {
          ok: true,
          results: [{ title: "S", url: "https://s.example/", snippet: "q" }]
        }
      },
      {
        name: "kanban_add",
        result: { ok: true, id: "c9", title: "T", state: "未着手" }
      }
    ]);
    expect(parts.map((p) => p.kind)).toEqual(["picks", "kanban_snip"]);
  });

  it("forms があれば form_fields を落とす", () => {
    const merged = mergeUiParts([
      {
        kind: "form_fields",
        commit: "assumptions",
        fields: [{ id: "price", label: "価格", type: "number" }]
      },
      {
        kind: "forms",
        title: "複合",
        commit: "speak_summary",
        sections: [
          {
            id: "s1",
            span: 2,
            fields: [
              { id: "rate", label: "金利", type: "slider", min: 0, max: 5, value: 1 },
              { id: "ok", label: "確認", type: "checkbox", value: false }
            ]
          }
        ]
      }
    ]);
    expect(merged.map((p) => p.kind)).toEqual(["forms"]);
    expect(merged[0]?.kind === "forms" && merged[0].sections).toHaveLength(1);
  });
});

describe("pickSelectionText", () => {
  it("url 付き候補の発話を作る", () => {
    expect(
      pickSelectionText({ id: "1", title: "甲", url: "https://a.example/" })
    ).toBe("「甲」を採用します。https://a.example/");
  });
});

describe("mapRowsToCompareTable", () => {
  it("汎用核は2行未満で空", () => {
    expect(
      mapRowsToCompareTable(
        [
          { id: "title", label: "名称" },
          { id: "price", label: "価格" }
        ],
        [{ id: "a", cells: { title: "A", price: "1" } }]
      )
    ).toEqual([]);
  });


});

describe("checklist / draft_preview merge", () => {
  it("merge で checklist と draft を残す", () => {
    const checklist: UiPart = {
      kind: "checklist",
      items: [
        { id: "a", label: "A", state: "pending" },
        { id: "b", label: "B", state: "pending" }
      ]
    };
    const draft: UiPart = { kind: "draft_preview", body: "本文" };
    const merged = mergeUiParts([checklist, draft]);
    expect(merged.map((p) => p.kind).sort()).toEqual(["checklist", "draft_preview"]);
  });
});

describe("resolveExclusivePresentSurfaces", () => {
  const checklist: UiPart = {
    kind: "checklist",
    items: [
      { id: "a", label: "申請", state: "pending" },
      { id: "b", label: "受領", state: "pending" }
    ]
  };
  const draft: UiPart = { kind: "draft_preview", title: "売主連絡", body: "はじめまして。" };

  it("下書き発話では checklist を落として draft だけ残す", () => {
    const resolved = resolveExclusivePresentSurfaces([checklist, draft], {
      userText: "売主への初回連絡文の下書きを出して。コピーできるようにして。"
    });
    expect(resolved.map((p) => p.kind)).toEqual(["draft_preview"]);
  });

  it("チェックリスト発話では draft を落として checklist だけ残す", () => {
    const resolved = resolveExclusivePresentSurfaces([checklist, draft], {
      userText: "登記取得の手順を進めるためのチェックリストを出して。"
    });
    expect(resolved.map((p) => p.kind)).toEqual(["checklist"]);
  });

  it("並列ジョブなら同居を許す", () => {
    const resolved = resolveExclusivePresentSurfaces([checklist, draft], {
      userText: "下書きを出して",
      parallelJobs: true
    });
    expect(resolved.map((p) => p.kind).sort()).toEqual(["checklist", "draft_preview"]);
  });

  it("発話が複数ジョブを明示したら両方残す", () => {
    const resolved = resolveExclusivePresentSurfaces([checklist, draft], {
      userText: "チェックリストと下書きの文案を両方出して"
    });
    expect(resolved.map((p) => p.kind).sort()).toEqual(["checklist", "draft_preview"]);
  });

  it("合図が無いときは後勝ち", () => {
    const resolved = resolveExclusivePresentSurfaces([checklist, draft], { userText: "お願い" });
    expect(resolved.map((p) => p.kind)).toEqual(["draft_preview"]);
  });
});
