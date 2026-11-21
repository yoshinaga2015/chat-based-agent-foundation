/** GenUI 認識チャネル用メディア（商品・宿・観光地など共通）。 */

export const MEDIA_IMAGES_MAX = 8;
/** inline strip に出す枚数。超過は後続ギャラリー用に保持。 */
export const MEDIA_INLINE_MAX = 3;

export type MediaImage = {
  url: string;
  alt?: string;
  role?: "hero" | "detail" | "context";
};

export function isHttpsMediaUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  const text = raw.trim();
  if (!text.toLowerCase().startsWith("https://")) return false;
  try {
    return new URL(text).protocol === "https:";
  } catch {
    return false;
  }
}

/** url でデデュペし上限内に切る。先勝ち。 */
export function mergeMediaImages(
  ...lists: (readonly MediaImage[] | undefined | null)[]
): MediaImage[] {
  const seen = new Set<string>();
  const out: MediaImage[] = [];
  for (const list of lists) {
    if (!list) continue;
    for (const item of list) {
      if (!isHttpsMediaUrl(item.url)) continue;
      const url = item.url.trim();
      if (seen.has(url)) continue;
      seen.add(url);
      const next: MediaImage = { url };
      if (item.alt?.trim()) next.alt = item.alt.trim();
      if (item.role) next.role = item.role;
      out.push(next);
      if (out.length >= MEDIA_IMAGES_MAX) return out;
    }
  }
  return out;
}

/** ツール／検索の雑な image フィールドを MediaImage[] にする。 */
export function mediaFromUnknown(raw: unknown): MediaImage[] {
  if (raw == null) return [];
  if (typeof raw === "string") {
    return isHttpsMediaUrl(raw) ? [{ url: raw.trim(), role: "hero" }] : [];
  }
  if (Array.isArray(raw)) {
    const out: MediaImage[] = [];
    for (const row of raw) {
      out.push(...mediaFromUnknown(row));
      if (out.length >= MEDIA_IMAGES_MAX) break;
    }
    return mergeMediaImages(out);
  }
  if (typeof raw === "object") {
    const row = raw as Record<string, unknown>;
    const url =
      (typeof row.url === "string" && row.url) ||
      (typeof row.contentUrl === "string" && row.contentUrl) ||
      (typeof row.image === "string" && row.image) ||
      "";
    if (!isHttpsMediaUrl(url)) return [];
    const alt =
      typeof row.alt === "string"
        ? row.alt
        : typeof row.name === "string"
          ? row.name
          : typeof row.caption === "string"
            ? row.caption
            : undefined;
    return [{ url: url.trim(), ...(alt?.trim() ? { alt: alt.trim() } : {}), role: "hero" }];
  }
  return [];
}

/** imageUrl と images を一つの列に正規化。 */
export function normalizeHitMedia(input: {
  imageUrl?: string;
  images?: readonly MediaImage[];
}): { images?: MediaImage[]; imageUrl?: string } {
  const images = mergeMediaImages(
    input.images,
    input.imageUrl ? [{ url: input.imageUrl, role: "hero" }] : undefined
  );
  if (images.length === 0) return {};
  return { images, imageUrl: images[0]!.url };
}
