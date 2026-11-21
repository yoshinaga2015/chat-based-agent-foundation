// Cloudflare Web Search API（AI バインディング → AI Gateway）。Tavily はフォールバック。
import { installedAi, type AiBinding } from "./config";
import { WEB_SEARCH_RESULTS } from "./limits";
import type { SearchHit } from "./search";

export type AsyncSearchAdapter = (query: string) => Promise<readonly SearchHit[]>;

/** Ceramic は日本語で 502／ノイズになりやすい。非 ASCII は Linkup → Exa を先に。 */
export const WEB_SEARCH_PROVIDERS = ["ceramic", "exa", "linkup"] as const;
export type WebSearchProvider = (typeof WEB_SEARCH_PROVIDERS)[number];

const JP = /[\u3040-\u30ff\u3400-\u9fff]/;

export function providersForQuery(query: string): readonly WebSearchProvider[] {
  return JP.test(query) ? ["linkup", "exa", "ceramic"] : ["ceramic", "exa", "linkup"];
}

/** 日本語クエリなのに英字ばかりなら、次のプロバイダを試す。 */
export function hitsMatchQuery(query: string, hits: readonly SearchHit[]): boolean {
  if (hits.length === 0) return false;
  if (!JP.test(query)) return true;
  const matched = hits.filter((hit) => JP.test(`${hit.title}\n${hit.snippet}`)).length;
  return matched >= Math.ceil(hits.length / 2);
}

export function cloudflareWebSearch(ai: AiBinding, provider: WebSearchProvider = "ceramic"): AsyncSearchAdapter {
  return async (query) => {
    const response = await ai.websearch({ query, provider, limit: WEB_SEARCH_RESULTS });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`websearch ${provider} ${response.status}: ${text.slice(0, 400)}`);
    }
    const json = await response.json() as { items?: unknown; result?: { items?: unknown } };
    const items = Array.isArray(json.items) ? json.items : Array.isArray(json.result?.items) ? json.result.items : [];
    return items.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const hitUrl = typeof row.url === "string" ? row.url : "";
      const title = typeof row.title === "string" ? row.title : "";
      const snippet = typeof row.description === "string"
        ? row.description
        : typeof row.snippet === "string"
          ? row.snippet
          : "";
      if (!hitUrl) return [];
      return [
        {
          url: hitUrl,
          title,
          snippet,
          ...hitMedia(row.image ?? row.imageUrl ?? row.thumbnail ?? row.thumbnailUrl, row.images)
        }
      ];
    });
  };
}

function hitMedia(
  primary: unknown,
  imagesField: unknown
): { imageUrl?: string; images?: { url: string; role?: "hero" | "detail" | "context" }[] } {
  const images: { url: string; role?: "hero" | "detail" | "context" }[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown, role: "hero" | "detail" = "detail") => {
    if (typeof raw !== "string") return;
    const text = raw.trim();
    if (!text.toLowerCase().startsWith("https://")) return;
    try {
      const parsed = new URL(text);
      if (parsed.protocol !== "https:") return;
      const url = parsed.toString();
      if (seen.has(url)) return;
      seen.add(url);
      images.push({ url, role: images.length === 0 ? "hero" : role });
    } catch {
      // ignore
    }
  };
  push(primary, "hero");
  if (Array.isArray(imagesField)) {
    for (const item of imagesField) {
      if (typeof item === "string") push(item);
      else if (item && typeof item === "object" && "url" in item) push((item as { url: unknown }).url);
    }
  }
  if (images.length === 0) return {};
  return { images, imageUrl: images[0]!.url };
}

export function tavilyWebSearch(apiKey: string, fetchImpl: typeof fetch = fetch): AsyncSearchAdapter {
  return async (query) => {
    const response = await fetchImpl("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: WEB_SEARCH_RESULTS,
        search_depth: "basic",
        include_images: true
      })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`tavily ${response.status}: ${text.slice(0, 400)}`);
    }
    const json = await response.json() as { results?: unknown; images?: unknown };
    const rows = Array.isArray(json.results) ? json.results : [];
    const gallery = Array.isArray(json.images)
      ? json.images.filter((item): item is string => typeof item === "string" && item.startsWith("https://"))
      : [];
    return rows.flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const hitUrl = typeof row.url === "string" ? row.url : "";
      const title = typeof row.title === "string" ? row.title : "";
      const snippet = typeof row.content === "string" ? row.content : "";
      if (!hitUrl) return [];
      const fromRow = hitMedia(row.image ?? row.imageUrl ?? row.thumbnail, row.images);
      const fromGallery = gallery[index] ? hitMedia(gallery[index], undefined) : {};
      const images = [...(fromRow.images ?? []), ...(fromGallery.images ?? [])];
      const seen = new Set<string>();
      const deduped = images.filter((img) => {
        if (seen.has(img.url)) return false;
        seen.add(img.url);
        return true;
      });
      return deduped.length
        ? [{ url: hitUrl, title, snippet, images: deduped, imageUrl: deduped[0]!.url }]
        : [{ url: hitUrl, title, snippet }];
    });
  };
}

/** Cloudflare の各プロバイダを試し、全滅したら Tavily。どちらも無ければ空。全滅エラーは throw。 */
export function productSearch(env: Readonly<Record<string, string | undefined>>, fetchImpl: typeof fetch = fetch): AsyncSearchAdapter {
  return async (query) => {
    const ai = installedAi();

    let lastError: unknown;
    let fallbackHits: readonly SearchHit[] | null = null;
    if (ai) {
      for (const provider of providersForQuery(query)) {
        try {
          const hits = await cloudflareWebSearch(ai, provider)(query);
          if (hitsMatchQuery(query, hits)) return hits;
          if (hits.length > 0 && !fallbackHits) fallbackHits = hits;
        } catch (error) {
          lastError = error;
        }
      }
    }

    const tavily = env["TAVILY_API_KEY"]?.trim() ?? "";
    if (tavily) {
      try {
        const hits = await tavilyWebSearch(tavily, fetchImpl)(query);
        if (hitsMatchQuery(query, hits)) return hits;
        if (hits.length > 0 && !fallbackHits) fallbackHits = hits;
      } catch (error) {
        lastError = error;
      }
    }

    if (fallbackHits) return fallbackHits;
    if (lastError) throw lastError;
    return [];
  };
}
