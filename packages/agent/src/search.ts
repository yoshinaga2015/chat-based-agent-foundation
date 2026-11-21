// 公の情報の検索。掲載の取得はここには置かない。
import { WEB_SEARCH_PER_TURN, WEB_SEARCH_RESULTS, WEB_SEARCH_SNIPPET_CHARS } from "./limits";
import { normalizeHitMedia, type MediaImage } from "./media";

export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
  /** https のサムネ／OGP。images[0] と同期。 */
  imageUrl?: string;
  /** 複数枚（商品・宿・観光地）。上限は media.MEDIA_IMAGES_MAX。 */
  images?: MediaImage[];
}

export type SearchAdapter = (query: string) => readonly SearchHit[] | Promise<readonly SearchHit[]>;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export type SearchOutcome =
  | { ok: true; results: SearchHit[] }
  | { ok: false; reason: "limit" | "email_in_query" | "unavailable" };

export function webSearch(callsSoFar: number, query: string, adapter: (query: string) => readonly SearchHit[]): SearchOutcome {
  if (callsSoFar >= WEB_SEARCH_PER_TURN) return { ok: false, reason: "limit" };
  if (EMAIL.test(query)) return { ok: false, reason: "email_in_query" };
  const results = adapter(query).slice(0, WEB_SEARCH_RESULTS).map((hit) => normalizeHit(hit));
  return { ok: true, results };
}

function normalizeHit(hit: SearchHit): SearchHit {
  const media = normalizeHitMedia(hit);
  return {
    url: hit.url,
    title: hit.title,
    snippet: hit.snippet.slice(0, WEB_SEARCH_SNIPPET_CHARS),
    ...media
  };
}

export async function webSearchAsync(callsSoFar: number, query: string, adapter: SearchAdapter): Promise<SearchOutcome> {
  if (callsSoFar >= WEB_SEARCH_PER_TURN) return { ok: false, reason: "limit" };
  if (EMAIL.test(query)) return { ok: false, reason: "email_in_query" };
  try {
    const raw = await Promise.resolve(adapter(query));
    const results = raw.slice(0, WEB_SEARCH_RESULTS).map((hit) => normalizeHit(hit));
    return { ok: true, results };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

const URL_PATTERN = /https?:\/\/[^\s)>\]]+/g;

/** ツールが返した URL だけをリンクにする。文からは消さない。 */
export function answerLinks(text: string, allowed: readonly string[]): { url: string; active: boolean }[] {
  const ok = new Set(allowed);
  return [...text.matchAll(URL_PATTERN)].map((match) => {
    const url = match[0].replace(/[.,。、]+$/, "");
    return { url, active: ok.has(url) };
  });
}
