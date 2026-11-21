/** 検索ヒットへページ画像（JSON-LD / OGP）を載せる。 */

import { assertBrowserUrl } from "./browser";
import {
  MEDIA_IMAGES_MAX,
  MEDIA_INLINE_MAX,
  mergeMediaImages,
  normalizeHitMedia,
  type MediaImage
} from "./media";
import type { SearchHit } from "./search";

export const OG_ENRICH_TIMEOUT_MS = 4_000;
export const OG_HTML_CHARS = 100_000;

const META_KEYS = ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"] as const;

/** 互換: 先頭1枚。 */
export function extractOgImage(html: string, pageUrl: string): string | null {
  return extractPageImages(html, pageUrl, 1)[0]?.url ?? null;
}

/** JSON-LD image 配列＋全 og/twitter:image を https のみで収集。 */
export function extractPageImages(html: string, pageUrl: string, max = MEDIA_IMAGES_MAX): MediaImage[] {
  const fromLd = extractJsonLdImages(html, pageUrl);
  const fromMeta = extractMetaImages(html, pageUrl);
  return mergeMediaImages(fromLd, fromMeta).slice(0, max);
}

function absolutizeHttps(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    if (url.protocol !== "https:") return null;
    const checked = assertBrowserUrl(url.toString());
    if (!checked.ok) return null;
    return checked.url.toString();
  } catch {
    return null;
  }
}

function metaContents(html: string, key: string): string[] {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<meta\\s+[^>]*(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*content\\s*=\\s*["']([^"']+)["'][^>]*/?>|<meta\\s+[^>]*content\\s*=\\s*["']([^"']+)["'][^>]*(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*/?>`,
    "gi"
  );
  const out: string[] = [];
  for (const match of html.matchAll(re)) {
    const value = match[1] ?? match[2];
    if (value) out.push(value);
  }
  return out;
}

function extractMetaImages(html: string, pageUrl: string): MediaImage[] {
  const out: MediaImage[] = [];
  for (const key of META_KEYS) {
    for (const content of metaContents(html, key)) {
      const absolute = absolutizeHttps(content.trim(), pageUrl);
      if (!absolute) continue;
      out.push({
        url: absolute,
        role: out.length === 0 ? "hero" : "detail"
      });
    }
  }
  return out;
}

function extractJsonLdImages(html: string, pageUrl: string): MediaImage[] {
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const out: MediaImage[] = [];
  for (const match of html.matchAll(re)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      collectLdImages(parsed, pageUrl, out);
    } catch {
      // JSON-LD 破損は無視
    }
    if (out.length >= MEDIA_IMAGES_MAX) break;
  }
  return out;
}

function collectLdImages(node: unknown, pageUrl: string, out: MediaImage[], depth = 0): void {
  if (depth > 8 || out.length >= MEDIA_IMAGES_MAX) return;
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) {
      collectLdImages(item, pageUrl, out, depth + 1);
      if (out.length >= MEDIA_IMAGES_MAX) return;
    }
    return;
  }
  if (typeof node !== "object") return;
  const row = node as Record<string, unknown>;
  pushLdImageField(row.image, pageUrl, out);
  pushLdImageField(row.photo, pageUrl, out);
  pushLdImageField(row.thumbnailUrl, pageUrl, out);
  for (const key of ["@graph", "mainEntity", "itemListElement", "hasPart", "containsPlace", "subjectOf"]) {
    if (row[key]) collectLdImages(row[key], pageUrl, out, depth + 1);
    if (out.length >= MEDIA_IMAGES_MAX) return;
  }
}

function pushLdImageField(raw: unknown, pageUrl: string, out: MediaImage[]): void {
  if (raw == null || out.length >= MEDIA_IMAGES_MAX) return;
  if (typeof raw === "string") {
    const absolute = absolutizeHttps(raw.trim(), pageUrl);
    if (absolute) out.push({ url: absolute, role: out.length === 0 ? "hero" : "detail" });
    return;
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      pushLdImageField(item, pageUrl, out);
      if (out.length >= MEDIA_IMAGES_MAX) return;
    }
    return;
  }
  if (typeof raw === "object") {
    const row = raw as Record<string, unknown>;
    const href =
      (typeof row.url === "string" && row.url) ||
      (typeof row.contentUrl === "string" && row.contentUrl) ||
      (typeof row["@id"] === "string" && row["@id"].startsWith("https://") ? row["@id"] : "") ||
      "";
    if (!href) return;
    const absolute = absolutizeHttps(href.trim(), pageUrl);
    if (!absolute) return;
    const alt =
      typeof row.name === "string" ? row.name : typeof row.caption === "string" ? row.caption : undefined;
    out.push({
      url: absolute,
      ...(alt?.trim() ? { alt: alt.trim() } : {}),
      role: out.length === 0 ? "hero" : "detail"
    });
  }
}

async function fetchPageImagesForUrl(
  pageUrl: string,
  fetchImpl: typeof fetch,
  allowHosts: readonly string[],
  timeoutMs: number
): Promise<MediaImage[]> {
  const checked = assertBrowserUrl(pageUrl, allowHosts);
  if (!checked.ok) return [];
  try {
    const response = await fetchImpl(checked.url.toString(), {
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "Mozilla/5.0 (compatible; fudo-og/1.0)"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) return [];
    const finalRaw = response.url?.trim() || checked.url.toString();
    const finalCheck = assertBrowserUrl(finalRaw, allowHosts);
    if (!finalCheck.ok) return [];
    const html = (await response.text()).slice(0, OG_HTML_CHARS);
    return extractPageImages(html, finalCheck.url.toString());
  } catch {
    return [];
  }
}

/**
 * images が薄いヒットにページ画像をマージする。
 * 既に inline 枚数以上ある場合はスキップ。失敗しても hits は返す。
 */
export async function enrichSearchHitsWithOg(
  hits: readonly SearchHit[],
  options: {
    fetchImpl?: typeof fetch;
    allowHosts?: readonly string[];
    timeoutMs?: number;
  } = {}
): Promise<SearchHit[]> {
  if (hits.length === 0) return [];
  const fetchImpl = options.fetchImpl ?? fetch;
  const allowHosts = options.allowHosts ?? [];
  const timeoutMs = options.timeoutMs ?? OG_ENRICH_TIMEOUT_MS;
  const out = hits.map((hit) => {
    const media = normalizeHitMedia(hit);
    return { ...hit, ...media };
  });

  await Promise.all(
    out.map(async (hit, index) => {
      const have = hit.images?.length ?? 0;
      if (have >= MEDIA_INLINE_MAX) return;
      const fetched = await fetchPageImagesForUrl(hit.url, fetchImpl, allowHosts, timeoutMs);
      if (fetched.length === 0) return;
      const media = normalizeHitMedia({
        imageUrl: hit.imageUrl,
        images: mergeMediaImages(hit.images, fetched)
      });
      out[index] = { ...hit, ...media };
    })
  );
  return out;
}
