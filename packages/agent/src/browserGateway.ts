import type { BrowserFetchAdapter } from "./browser";
import { truncateMarkdown } from "./browser";

type FetchLike = typeof fetch;

/**
 * browser_fetch の製品アダプタ。
 * 固定費なしの Jina Reader → 自前 HTTP 抽出。
 * @see docs/design/2026-10-28-browser-fetch-no-paid.md
 */
export function productBrowserFetch(
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl: FetchLike = fetch
): BrowserFetchAdapter | undefined {
  const mode = (env["FUDO_BROWSER_FETCH"]?.trim().toLowerCase() || "auto") as string;
  if (mode === "off" || mode === "none") return undefined;

  const adapters: BrowserFetchAdapter[] = [];
  if (mode === "auto" || mode === "jina") {
    adapters.push(jinaReaderFetch(env, fetchImpl));
  }
  if (mode === "auto" || mode === "http") {
    adapters.push(httpReadableFetch(fetchImpl));
  }
  if (adapters.length === 0) return undefined;

  return async (url) => {
    let lastError: Error | null = null;
    for (const adapter of adapters) {
      try {
        return await adapter(url);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        // 認証・権限不足は次の手段へ（Paid 無し CF を黙って落とす）
        if (error && typeof error === "object" && "status" in error) {
          const status = (error as { status?: number }).status;
          if (status === 401 || status === 403) continue;
        }
        if (/authentication|authorization|permission|api token|provider_auth/i.test(lastError.message)) {
          continue;
        }
        // 一時障害以外は次も試す（個人開発の耐性優先）
        continue;
      }
    }
    throw lastError ?? new Error("browser_fetch_unavailable");
  };
}

function jinaReaderFetch(
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl: FetchLike
): BrowserFetchAdapter {
  const apiKey = env["JINA_API_KEY"]?.trim() ?? "";
  return async (url) => {
    const endpoint = `https://r.jina.ai/${url}`;
    const headers: Record<string, string> = {
      Accept: "text/plain",
      "X-Return-Format": "markdown"
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetchImpl(endpoint, { method: "GET", headers });
    const text = await response.text();
    if (!response.ok) {
      const err = new Error(`jina_reader_http_${response.status}`) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }
    const markdownRaw = text.trim();
    if (!markdownRaw) throw new Error("jina_reader_empty");
    const cut = truncateMarkdown(markdownRaw);
    const titleMatch = /^Title:\s*(.+)$/m.exec(markdownRaw);
    return {
      url,
      title: titleMatch?.[1]?.trim(),
      markdown: cut.text,
      truncated: cut.truncated
    };
  };
}

/** ヘッドレス無し。静的 HTML から本文っぽいテキストを取る。 */
function httpReadableFetch(fetchImpl: FetchLike): BrowserFetchAdapter {
  return async (url) => {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "User-Agent": "fudo-browser-fetch/1.0 (+https://example.invalid)"
      },
      redirect: "follow"
    });
    const html = await response.text();
    if (!response.ok) {
      const err = new Error(`http_fetch_${response.status}`) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }
    const finalUrl = response.url || url;
    const title = extractHtmlTitle(html);
    const markdownRaw = htmlToRoughMarkdown(html);
    if (!markdownRaw.trim()) throw new Error("http_fetch_empty");
    const cut = truncateMarkdown(markdownRaw);
    return {
      url,
      finalUrl,
      title,
      markdown: cut.text,
      truncated: cut.truncated
    };
  };
}

function extractHtmlTitle(html: string): string | undefined {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const title = match?.[1]?.replace(/\s+/g, " ").trim();
  return title || undefined;
}

/** 依存ゼロの粗い本文化。完璧さより「読める」を優先。 */
export function htmlToRoughMarkdown(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  text = text
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
  text = text.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}
