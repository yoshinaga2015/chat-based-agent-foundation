import { describe, expect, it, vi } from "vitest";
import {
  assertBrowserUrl,
  browserFetch,
  isBrowserHostAllowed,
  parseBrowserHostAllow,
  truncateMarkdown
} from "./browser";
import { productBrowserFetch } from "./browserGateway";
import { describeToolActivity } from "./activity";

describe("browser 許可ホスト", () => {
  it("プライベート網と http を拒む", () => {
    expect(assertBrowserUrl("http://example.com").ok).toBe(false);
    expect(assertBrowserUrl("https://127.0.0.1/").ok).toBe(false);
    expect(assertBrowserUrl("https://192.168.1.1/").ok).toBe(false);
    expect(assertBrowserUrl("https://example.com/a").ok).toBe(true);
    expect(assertBrowserUrl("https://[::ffff:127.0.0.1]/").ok).toBe(false);
    expect(assertBrowserUrl("https://[::ffff:7f00:1]/").ok).toBe(false);
    expect(assertBrowserUrl("https://localtest.me/").ok).toBe(false);
    expect(assertBrowserUrl("https://[fc00::1]/").ok).toBe(false);
  });

  it("redirect 先がプライベートなら拒否", async () => {
    const outcome = await browserFetch(0, "https://example.com/", async () => ({
      url: "https://example.com/",
      finalUrl: "https://127.0.0.1/secret",
      markdown: "leak",
      truncated: false
    }));
    expect(outcome).toMatchObject({ ok: false, reason: "private_host" });
  });

  it("allow リストがあるときだけ通す", () => {
    const allow = parseBrowserHostAllow("example.com, docs.cloudflare.com");
    expect(isBrowserHostAllowed("example.com", allow)).toBe(true);
    expect(isBrowserHostAllowed("www.example.com", allow)).toBe(true);
    expect(isBrowserHostAllowed("evil.com", allow)).toBe(false);
  });
});

describe("browserFetch", () => {
  it("上限と adapter 欠如を返す", async () => {
    const { BROWSER_FETCH_PER_TURN } = await import("./limits");
    expect(await browserFetch(BROWSER_FETCH_PER_TURN, "https://example.com", undefined)).toMatchObject({
      ok: false,
      reason: "limit"
    });
    expect(await browserFetch(0, "https://example.com", undefined)).toMatchObject({
      ok: false,
      reason: "unavailable"
    });
  });

  it("API 401 は provider_auth（対象ページの認証ではない）", async () => {
    const outcome = await browserFetch(0, "https://example.com/", async () => {
      const err = new Error("Authentication error") as Error & { status?: number };
      err.status = 401;
      throw err;
    });
    expect(outcome).toMatchObject({ ok: false, reason: "provider_auth" });
  });

  it("成功時は markdown を切る", async () => {
    const long = "x".repeat(20_000);
    const outcome = await browserFetch(0, "https://example.com/page", async () => ({
      url: "https://example.com/page",
      markdown: long,
      truncated: false
    }));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.truncated).toBe(true);
      expect(outcome.result.markdown.length).toBeLessThanOrEqual(12_000);
    }
  });

  it("有料壁っぽい短い本文は content_wall", async () => {
    const outcome = await browserFetch(0, "https://example.com/article", async () => ({
      url: "https://example.com/article",
      markdown: "Subscribe to continue reading this article.",
      truncated: false
    }));
    expect(outcome).toMatchObject({ ok: false, reason: "content_wall" });
  });

  it("短い汎用エラーページは unusable_content", async () => {
    const outcome = await browserFetch(0, "https://example.com/quote", async () => ({
      url: "https://example.com/quote",
      markdown: "Oops, something went wrong. Please try again later.",
      truncated: false
    }));
    expect(outcome).toMatchObject({ ok: false, reason: "unusable_content" });
  });
});

describe("productBrowserFetch", () => {
  it("既定は資格情報なしでもアダプタを返す（Jina / HTTP）", () => {
    expect(productBrowserFetch({})).toBeTypeOf("function");
    expect(productBrowserFetch({ FUDO_BROWSER_FETCH: "off" })).toBeUndefined();
  });

  it("Jina Reader を先に呼ぶ", async () => {
    const fetchImpl = vi.fn(async () => new Response("Title: Hello\n\n# Hello\n\nWorld", { status: 200 }));
    const adapter = productBrowserFetch({ FUDO_BROWSER_FETCH: "jina" }, fetchImpl as unknown as typeof fetch);
    const result = await adapter!("https://example.com/");
    expect(result.markdown).toContain("Hello");
    expect(result.title).toBe("Hello");
    const calledUrl = String((fetchImpl.mock.calls as unknown as [unknown, ...unknown[]][])[0]?.[0] ?? "");
    expect(calledUrl).toContain("r.jina.ai/https://example.com/");
  });
});

describe("activity browser_fetch", () => {
  it("ホスト名をラベルに入れる", () => {
    const row = describeToolActivity("browser_fetch", { url: "https://docs.cloudflare.com/x" }, "running");
    expect(row.kind).toBe("browser");
    expect(row.label).toBe("docs.cloudflare.com を読んでいます");
  });
});

describe("truncateMarkdown", () => {
  it("短い文はそのまま", () => {
    expect(truncateMarkdown("hi")).toEqual({ text: "hi", truncated: false });
  });
});
