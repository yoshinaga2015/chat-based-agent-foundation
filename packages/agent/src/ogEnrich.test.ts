import { describe, expect, it, vi } from "vitest";
import { enrichSearchHitsWithOg, extractOgImage, extractPageImages } from "./ogEnrich";

describe("extractOgImage", () => {
  it("property=og:image を取る", () => {
    const html = `<html><head><meta property="og:image" content="https://cdn.example/p.jpg" /></head></html>`;
    expect(extractOgImage(html, "https://shop.example/item")).toBe("https://cdn.example/p.jpg");
  });

  it("相対パスを絶対 https にする", () => {
    const html = `<meta property="og:image" content="/img/a.jpg" />`;
    expect(extractOgImage(html, "https://shop.example/item/1")).toBe("https://shop.example/img/a.jpg");
  });

  it("http や javascript は落とす", () => {
    expect(
      extractOgImage(`<meta property="og:image" content="http://insecure.example/x.jpg" />`, "https://a.example/")
    ).toBeNull();
  });
});

describe("extractPageImages", () => {
  it("JSON-LD Product.image 配列を取る", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Product",
      name: "瓶",
      image: ["https://cdn.example/1.jpg", "https://cdn.example/2.jpg", "/3.jpg"]
    })}</script>`;
    const images = extractPageImages(html, "https://shop.example/p");
    expect(images.map((i) => i.url)).toEqual([
      "https://cdn.example/1.jpg",
      "https://cdn.example/2.jpg",
      "https://shop.example/3.jpg"
    ]);
  });

  it("複数 og:image と JSON-LD をマージする", () => {
    const html = `
      <meta property="og:image" content="https://cdn.example/og1.jpg" />
      <meta property="og:image" content="https://cdn.example/og2.jpg" />
      <script type="application/ld+json">${JSON.stringify({
        "@type": "Product",
        image: "https://cdn.example/ld.jpg"
      })}</script>`;
    const urls = extractPageImages(html, "https://shop.example/").map((i) => i.url);
    expect(urls[0]).toBe("https://cdn.example/ld.jpg");
    expect(urls).toContain("https://cdn.example/og1.jpg");
    expect(urls).toContain("https://cdn.example/og2.jpg");
  });
});

describe("enrichSearchHitsWithOg", () => {
  it("薄い images をページ画像で埋める", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("a.example")) {
        return new Response(
          `<script type="application/ld+json">${JSON.stringify({
            "@type": "Product",
            image: ["https://img.example/a1.jpg", "https://img.example/a2.jpg"]
          })}</script>`,
          { status: 200, headers: { "content-type": "text/html" } }
        );
      }
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;

    const hits = await enrichSearchHitsWithOg(
      [
        { url: "https://a.example/1", title: "A", snippet: "s" },
        {
          url: "https://b.example/2",
          title: "B",
          snippet: "s",
          images: [
            { url: "https://cdn.example/1.jpg" },
            { url: "https://cdn.example/2.jpg" },
            { url: "https://cdn.example/3.jpg" }
          ]
        }
      ],
      { fetchImpl }
    );

    expect(hits[0]?.images?.map((i) => i.url)).toEqual([
      "https://img.example/a1.jpg",
      "https://img.example/a2.jpg"
    ]);
    expect(hits[0]?.imageUrl).toBe("https://img.example/a1.jpg");
    expect(hits[1]?.images).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("取得失敗でもヒットは残す", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;

    const hits = await enrichSearchHitsWithOg(
      [{ url: "https://a.example/1", title: "A", snippet: "s" }],
      { fetchImpl }
    );
    expect(hits).toEqual([{ url: "https://a.example/1", title: "A", snippet: "s" }]);
  });

  it("プライベートホストは取りに行かない", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const hits = await enrichSearchHitsWithOg(
      [{ url: "https://127.0.0.1/x", title: "local", snippet: "s" }],
      { fetchImpl }
    );
    expect(hits[0]?.imageUrl).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
