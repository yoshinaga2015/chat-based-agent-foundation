import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ChatMarkdown, enrichChatMarkdown, extractMarkdownImages } from "./ChatMarkdown";

describe("enrichChatMarkdown", () => {
  it("/property パスを Markdown リンクにする", () => {
    expect(enrichChatMarkdown("開く /property/abc です")).toBe("開く [/property/abc](/property/abc) です");
    expect(enrichChatMarkdown("(/property/x)")).toBe("([/property/x](/property/x))");
  });

  it("既存の Markdown は壊さない", () => {
    const src = "見る [REINS](https://www.reins.or.jp/)";
    expect(enrichChatMarkdown(src)).toBe(src);
  });

  it("全角括弧・日本語の直前で URL を切る", () => {
    const src =
      "全国地価マップ（https://www.chikamap.jp/chikamap/Portal）を開いてください。「相続税」";
    expect(enrichChatMarkdown(src)).toBe(
      "全国地価マップ（[https://www.chikamap.jp/chikamap/Portal](https://www.chikamap.jp/chikamap/Portal)）を開いてください。「相続税」"
    );
  });
});

describe("ChatMarkdown URL CJK", () => {
  it("全角）以降をリンクに含めない", () => {
    const html = renderToStaticMarkup(
      createElement(ChatMarkdown, {
        text: "全国地価マップ（https://www.chikamap.jp/chikamap/Portal）を開いてください。「相続税路線価等」"
      })
    );
    expect(html).toContain('href="https://www.chikamap.jp/chikamap/Portal"');
    expect(html).not.toContain("%EF%BC%89");
    expect(html).toContain("）を開いてください。");
    expect(html).toContain("「相続税路線価等」");
  });
});

describe("extractMarkdownImages", () => {
  it("表内のリンク付き画像も集める", () => {
    const text = `| A | B |
| --- | --- |
| [![外観](https://cdn.example/a.jpg)](https://hotel.example/a) | ![客室](https://cdn.example/b.png) |`;
    expect(extractMarkdownImages(text).map((i) => i.url)).toEqual([
      "https://cdn.example/a.jpg",
      "https://cdn.example/b.png"
    ]);
  });
});

describe("ChatMarkdown CJK", () => {
  it("かぎ括弧に接する ** を太字にする", () => {
    const html = renderToStaticMarkup(
      createElement(ChatMarkdown, {
        text: "最新は**「月例速報 2026年3月度」**です。"
      })
    );
    expect(html).toContain("<strong");
    expect(html).not.toContain("**「");
  });

  it("リンク付き画像はページ a を外し拡大用 img だけ残す", () => {
    const html = renderToStaticMarkup(
      createElement(ChatMarkdown, {
        text: "[![外観](https://cdn.example/a.jpg)](https://hotel.example/a)"
      })
    );
    expect(html).toContain('aria-label="外観を拡大"');
    expect(html).toContain("cursor-zoom-in");
    expect(html).toContain("https://cdn.example/a.jpg");
    expect(html).not.toContain("https://hotel.example/a");
  });
});
