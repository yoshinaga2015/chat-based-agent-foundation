/** 住所・施設名 → 座標候補。曖昧さは潰さず候補を返す（近傍への強制寄せはしない）。 */

import { haversineMeters } from "./places";

export type GeocodedPlace = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  query: string;
  source: "gsi" | "nominatim";
};

export type GeocodeFail = {
  ok: false;
  reason: "query_required" | "network_error" | "geocode_http" | "geocode_parse" | "not_found";
  detail?: unknown;
};

const DEFAULT_GSI = "https://msearch.gsi.go.jp/address-search/AddressSearch";
const DEFAULT_NOMINATIM = "https://nominatim.openstreetmap.org";
const USER_AGENT = "fudo-agent/1.0 (property desk; route geocode)";
const CANDIDATE_MAX = 8;

export function gsiGeocodeUrl(env: { FUDO_GSI_GEOCODE_URL?: string } | undefined = undefined): string {
  const fromEnv =
    env?.FUDO_GSI_GEOCODE_URL?.trim() ||
    (typeof process !== "undefined" ? process.env.FUDO_GSI_GEOCODE_URL?.trim() : undefined);
  if (fromEnv) return fromEnv;
  return DEFAULT_GSI;
}

export function nominatimBaseUrl(env: { FUDO_GEOCODE_URL?: string } | undefined = undefined): string {
  const fromEnv =
    env?.FUDO_GEOCODE_URL?.trim() ||
    (typeof process !== "undefined" ? process.env.FUDO_GEOCODE_URL?.trim() : undefined);
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return DEFAULT_NOMINATIM;
}

/** @deprecated 互換。Nominatim ベース。 */
export function geocodeBaseUrl(env?: { FUDO_GEOCODE_URL?: string }): string {
  return nominatimBaseUrl(env);
}

/** 番地付き住所っぽいか（日本）。施設名だけのクエリは false。 */
export function looksLikeJapaneseAddress(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  const hasAdmin = /[都道府県市区町村]/.test(q) || /丁目/.test(q);
  const hasNumber = /\d|[０-９]|番地|号/.test(q);
  return hasAdmin && hasNumber;
}

/** 起点ラベルから地域ヒントを取り、目的地クエリの変形に足す（候補を増やす。遠い候補は消さない）。 */
export function areaHintsFromLabel(label: string): string[] {
  const text = label.trim();
  if (!text) return [];
  const hints: string[] = [];
  const ku = text.match(/((?:東京都|北海道|京都府|大阪府|[^都道府県]*[都道府県])?[^市区町村]*[市区])/);
  if (ku?.[1]) hints.push(ku[1]);
  const machi = text.match(/[市区]([^\s\d一二三四五六七八九十０-９]+(?:町|村)?)/);
  if (machi?.[1] && ku?.[1]) hints.push(`${ku[1]}${machi[1]}`);
  return [...new Set(hints.filter(Boolean))];
}

function queryVariants(query: string, areaHints: readonly string[] = []): string[] {
  const q = query.trim();
  const out = [q];
  if (/^(足立|練馬|板橋|江戸川|葛飾|北|荒川|台東|墨田|江東|品川|目黒|大田|世田谷|渋谷|中野|杉並|豊島|文京|千代田|中央|港|新宿)区/.test(q)) {
    out.push(`東京都${q}`);
  }
  for (const area of areaHints) {
    if (!q.includes(area)) out.push(`${area} ${q}`);
  }
  return [...new Set(out)];
}

function placeId(lat: number, lng: number, label: string): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}:${label.slice(0, 24)}`;
}

function parseGsiFeatures(json: unknown, query: string): GeocodedPlace[] {
  if (!Array.isArray(json)) return [];
  const out: GeocodedPlace[] = [];
  for (const row of json) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const feature = row as Record<string, unknown>;
    const geometry = feature.geometry;
    if (!geometry || typeof geometry !== "object" || Array.isArray(geometry)) continue;
    const coords = (geometry as Record<string, unknown>).coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lng = coords[0];
    const lat = coords[1];
    if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      continue;
    }
    const props = feature.properties;
    const title =
      props && typeof props === "object" && !Array.isArray(props) && typeof (props as Record<string, unknown>).title === "string"
        ? String((props as Record<string, unknown>).title).trim()
        : query;
    const label = title || query;
    out.push({
      id: placeId(lat, lng, label),
      lat,
      lng,
      label,
      query,
      source: "gsi"
    });
    if (out.length >= CANDIDATE_MAX) break;
  }
  return out;
}

function parseNominatimRows(json: unknown, query: string): GeocodedPlace[] {
  if (!Array.isArray(json)) return [];
  const out: GeocodedPlace[] = [];
  for (const row of json) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const body = row as Record<string, unknown>;
    const lat = typeof body.lat === "string" ? Number(body.lat) : typeof body.lat === "number" ? body.lat : NaN;
    const lng = typeof body.lon === "string" ? Number(body.lon) : typeof body.lon === "number" ? body.lon : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const label =
      typeof body.display_name === "string" && body.display_name.trim()
        ? body.display_name.trim()
        : query;
    out.push({
      id: placeId(lat, lng, label),
      lat,
      lng,
      label,
      query,
      source: "nominatim"
    });
    if (out.length >= CANDIDATE_MAX) break;
  }
  return out;
}

async function fetchGsiCandidates(
  query: string,
  options: { fetchImpl?: typeof fetch; url?: string }
): Promise<{ ok: true; places: GeocodedPlace[] } | GeocodeFail> {
  const base = options.url ?? gsiGeocodeUrl();
  const url = `${base}?${new URLSearchParams({ q: query }).toString()}`;
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" } });
  } catch (error) {
    return { ok: false, reason: "network_error", detail: { message: String(error), source: "gsi" } };
  }
  if (!response.ok) {
    return { ok: false, reason: "geocode_http", detail: { status: response.status, source: "gsi" } };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, reason: "geocode_parse", detail: { source: "gsi" } };
  }
  const places = parseGsiFeatures(json, query);
  if (!places.length) return { ok: false, reason: "not_found", detail: { query, source: "gsi" } };
  return { ok: true, places };
}

async function fetchNominatimCandidates(
  query: string,
  options: { fetchImpl?: typeof fetch; baseUrl?: string; countrycodes?: string }
): Promise<{ ok: true; places: GeocodedPlace[] } | GeocodeFail> {
  const base = options.baseUrl ?? nominatimBaseUrl();
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: String(CANDIDATE_MAX),
    addressdetails: "0"
  });
  if (options.countrycodes !== "") {
    params.set("countrycodes", options.countrycodes ?? "jp");
  }
  const url = `${base}/search?${params.toString()}`;
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json", "user-agent": USER_AGENT }
    });
  } catch (error) {
    return { ok: false, reason: "network_error", detail: { message: String(error), source: "nominatim" } };
  }
  if (!response.ok) {
    return { ok: false, reason: "geocode_http", detail: { status: response.status, source: "nominatim" } };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, reason: "geocode_parse", detail: { source: "nominatim" } };
  }
  const places = parseNominatimRows(json, query);
  if (!places.length) return { ok: false, reason: "not_found", detail: { query, source: "nominatim" } };
  return { ok: true, places };
}

function dedupePlaces(places: readonly GeocodedPlace[]): GeocodedPlace[] {
  const seen = new Set<string>();
  const out: GeocodedPlace[] = [];
  for (const p of places) {
    const key = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= CANDIDATE_MAX) break;
  }
  return out;
}

/** 起点が分かるときだけ並びを寄せる。遠い候補は捨てない。 */
export function rankCandidatesNear(
  places: readonly GeocodedPlace[],
  near: { lat: number; lng: number } | null
): GeocodedPlace[] {
  if (!near) return [...places];
  return [...places].sort(
    (a, b) => haversineMeters(near, a) - haversineMeters(near, b)
  );
}

/**
 * 複数ソース・表記ゆれから候補を集める。
 * `near` / `areaHints` は順位とクエリ変形のみ。候補の削除には使わない。
 */
export async function geocodeCandidates(
  query: string,
  options: {
    fetchImpl?: typeof fetch;
    baseUrl?: string;
    gsiUrl?: string;
    countrycodes?: string;
    near?: { lat: number; lng: number } | null;
    areaHints?: readonly string[];
  } = {}
): Promise<{ ok: true; places: GeocodedPlace[] } | GeocodeFail> {
  const q = query.trim();
  if (!q) return { ok: false, reason: "query_required" };
  const variants = queryVariants(q, options.areaHints ?? []);
  const addressLike = looksLikeJapaneseAddress(q);
  const collected: GeocodedPlace[] = [];
  let lastFail: GeocodeFail = { ok: false, reason: "not_found", detail: { query: q } };

  const runVariant = async (variant: string) => {
    const gsi = await fetchGsiCandidates(variant, {
      fetchImpl: options.fetchImpl,
      url: options.gsiUrl
    });
    if (gsi.ok) collected.push(...gsi.places);
    else lastFail = gsi;
    const nom = await fetchNominatimCandidates(variant, {
      fetchImpl: options.fetchImpl,
      baseUrl: options.baseUrl,
      countrycodes: options.countrycodes
    });
    if (nom.ok) collected.push(...nom.places);
    else if (!gsi.ok) lastFail = nom;
  };

  // 住所は GSI を先に叩くが、候補は両ソースとも集める
  if (addressLike) {
    for (const variant of variants) await runVariant(variant);
  } else {
    for (const variant of variants) {
      const nom = await fetchNominatimCandidates(variant, {
        fetchImpl: options.fetchImpl,
        baseUrl: options.baseUrl,
        countrycodes: options.countrycodes
      });
      if (nom.ok) collected.push(...nom.places);
      else lastFail = nom;
      const gsi = await fetchGsiCandidates(variant, {
        fetchImpl: options.fetchImpl,
        url: options.gsiUrl
      });
      if (gsi.ok) collected.push(...gsi.places);
      else if (!nom.ok) lastFail = gsi;
    }
  }

  const places = rankCandidatesNear(dedupePlaces(collected), options.near ?? null);
  if (!places.length) return lastFail;
  return { ok: true, places };
}

/** 一意に決まるときだけ1件。曖昧なら失敗にせず candidates 側を使うこと。 */
export async function geocodeAddress(
  query: string,
  options: {
    fetchImpl?: typeof fetch;
    baseUrl?: string;
    gsiUrl?: string;
    countrycodes?: string;
    near?: { lat: number; lng: number } | null;
    areaHints?: readonly string[];
  } = {}
): Promise<{ ok: true; place: GeocodedPlace } | GeocodeFail> {
  const result = await geocodeCandidates(query, options);
  if (!result.ok) return result;
  if (result.places.length !== 1) {
    return {
      ok: false,
      reason: "not_found",
      detail: { query, ambiguous: true, count: result.places.length }
    };
  }
  return { ok: true, place: result.places[0]! };
}
