/** OSRM 経路。住所は候補化し、曖昧なら経路を張らず選ばせる。近傍への強制寄せはしない。 */

import { areaHintsFromLabel, geocodeCandidates, type GeocodedPlace } from "./geocode";
import { haversineMeters } from "./places";

export type RouteProfile = "foot" | "bike" | "car";

export type RoutePoint = {
  id: string;
  title: string;
  lat: number;
  lng: number;
  /** ジオコードに使ったクエリ（あれば） */
  query?: string;
};

export type ResolvedRoute = {
  ok: true;
  profile: RouteProfile;
  distanceM: number;
  durationS: number;
  origin: RoutePoint;
  destination: RoutePoint;
  coordinates: { lat: number; lng: number }[];
};

export type ResolveRouteAmbiguous = {
  ok: false;
  reason: "ambiguous";
  query: string;
  /** どの端点が曖昧か */
  endpoint: "origin" | "destination";
  origin?: RoutePoint;
  candidates: RoutePoint[];
};

export type ResolveRouteFail = {
  ok: false;
  reason: string;
  detail?: unknown;
};

/** デモ既定。徒歩／自転車は FOSSGIS（OSM.de）。車も同系統。`FUDO_OSRM_URL` で上書き可。 */
const FOSSGIS = {
  foot: "https://routing.openstreetmap.de/routed-foot/route/v1/driving",
  bike: "https://routing.openstreetmap.de/routed-bike/route/v1/driving",
  car: "https://routing.openstreetmap.de/routed-car/route/v1/driving"
} as const;
const FALLBACK_OSRM = "https://router.project-osrm.org";
const COORDS_MAX = 160;
const USER_AGENT = "fudo-agent/1.0 (property desk; route)";
/** Nominatim 公開枠: 合計 1 req/s。起終点の連続ジオコード間隔。 */
const GEOCODE_GAP_MS = 1100;

function isFiniteNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function point(raw: unknown): { lat: number; lng: number } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!isFiniteNum(o.lat) || !isFiniteNum(o.lng)) return null;
  if (o.lat < -90 || o.lat > 90 || o.lng < -180 || o.lng > 180) return null;
  return { lat: o.lat, lng: o.lng };
}

function textField(raw: Record<string, unknown>, key: string): string {
  const v = raw[key];
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

function profileOf(raw: unknown): RouteProfile {
  if (raw === "bike" || raw === "car" || raw === "foot") return raw;
  return "foot";
}

export function osrmBaseUrl(env: { FUDO_OSRM_URL?: string } | undefined = undefined): string {
  const fromEnv =
    env?.FUDO_OSRM_URL?.trim() ||
    (typeof process !== "undefined" ? process.env.FUDO_OSRM_URL?.trim() : undefined);
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return FALLBACK_OSRM;
}

/** 経路リクエスト URL。カスタム base が無ければ FOSSGIS → 呼び出し側で project-osrm にフォールバック。 */
export function osrmRouteUrls(
  profile: RouteProfile,
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  baseOverride?: string
): string[] {
  const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const qs = "overview=full&geometries=geojson";
  if (baseOverride?.trim()) {
    const base = baseOverride.replace(/\/$/, "");
    return [`${base}/route/v1/${profile}/${coords}?${qs}`];
  }
  return [
    `${FOSSGIS[profile]}/${coords}?${qs}`,
    `${FALLBACK_OSRM}/route/v1/${profile}/${coords}?${qs}`
  ];
}

/** GeoJSON LineString 座標 [lng,lat][] → 間引き済み {lat,lng}[] */
export function thinRouteCoordinates(
  lngLat: readonly (readonly number[])[],
  max = COORDS_MAX
): { lat: number; lng: number }[] {
  const valid: { lat: number; lng: number }[] = [];
  for (const pair of lngLat) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const lng = pair[0];
    const lat = pair[1];
    if (!isFiniteNum(lat) || !isFiniteNum(lng)) continue;
    valid.push({ lat, lng });
  }
  if (valid.length <= max) return valid;
  const step = Math.ceil(valid.length / max);
  const out: { lat: number; lng: number }[] = [];
  for (let i = 0; i < valid.length; i += step) out.push(valid[i]!);
  const last = valid[valid.length - 1]!;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function toRoutePoint(place: GeocodedPlace, titleFallback: string): RoutePoint {
  return {
    id: place.id,
    title: place.label || titleFallback,
    lat: place.lat,
    lng: place.lng,
    query: place.query
  };
}

type EndpointOk = { ok: true; point: RoutePoint };
type EndpointAmbiguous = {
  ok: false;
  reason: "ambiguous";
  query: string;
  candidates: RoutePoint[];
};
type EndpointFail = ResolveRouteFail;

async function resolveEndpoint(
  raw: unknown,
  fallbackTitle: string,
  options: {
    fetchImpl?: typeof fetch;
    geocodeBaseUrl?: string;
    gsiUrl?: string;
    near?: { lat: number; lng: number } | null;
    areaHints?: readonly string[];
  }
): Promise<EndpointOk | EndpointAmbiguous | EndpointFail> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "invalid_endpoint" };
  }
  const body = raw as Record<string, unknown>;
  const loc = point(raw);
  const title = textField(body, "title") || textField(body, "address") || fallbackTitle;
  if (loc) {
    return {
      ok: true,
      point: {
        id: textField(body, "id") || `${loc.lat.toFixed(5)},${loc.lng.toFixed(5)}`,
        title,
        lat: loc.lat,
        lng: loc.lng
      }
    };
  }
  const query = textField(body, "address") || textField(body, "title");
  if (!query) {
    return {
      ok: false,
      reason: "endpoint_required",
      detail: { constraint: "lat/lng か address（または title）が要る" }
    };
  }
  const geo = await geocodeCandidates(query, {
    fetchImpl: options.fetchImpl,
    baseUrl: options.geocodeBaseUrl,
    gsiUrl: options.gsiUrl,
    near: options.near,
    areaHints: options.areaHints
  });
  if (!geo.ok) {
    return {
      ok: false,
      reason: geo.reason === "not_found" ? "geocode_not_found" : `geocode_${geo.reason}`,
      detail: { ...("detail" in geo ? geo.detail : {}), query, endpoint: fallbackTitle }
    };
  }
  if (geo.places.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      query,
      candidates: geo.places.map((p) => toRoutePoint(p, title))
    };
  }
  const only = geo.places[0]!;
  return {
    ok: true,
    point: {
      id: textField(body, "id") || only.id,
      title: textField(body, "title") || only.label,
      lat: only.lat,
      lng: only.lng,
      query
    }
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resolveRoute(
  args: unknown,
  options: {
    fetchImpl?: typeof fetch;
    baseUrl?: string;
    geocodeBaseUrl?: string;
    gsiUrl?: string;
    geocodeGapMs?: number;
  } = {}
): Promise<ResolvedRoute | ResolveRouteAmbiguous | ResolveRouteFail> {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, reason: "invalid_args" };
  }
  const body = args as Record<string, unknown>;
  const originRaw = body.origin;
  const destRaw = body.destination;
  const originNeedsGeo = !point(originRaw);
  const destNeedsGeo = !point(destRaw);

  const originResult = await resolveEndpoint(originRaw, "起点", options);
  if (!originResult.ok) {
    if (originResult.reason === "ambiguous") {
      return {
        ok: false,
        reason: "ambiguous",
        endpoint: "origin",
        query: originResult.query,
        candidates: originResult.candidates
      };
    }
    return originResult;
  }
  const o = originResult.point;

  if (originNeedsGeo && destNeedsGeo) {
    await sleep(options.geocodeGapMs ?? GEOCODE_GAP_MS);
  }

  const destResult = await resolveEndpoint(destRaw, "終点", {
    ...options,
    near: o,
    areaHints: areaHintsFromLabel(o.title)
  });
  if (!destResult.ok) {
    if (destResult.reason === "ambiguous") {
      return {
        ok: false,
        reason: "ambiguous",
        endpoint: "destination",
        query: destResult.query,
        origin: o,
        candidates: destResult.candidates
      };
    }
    return destResult;
  }
  const d = destResult.point;
  const profile = profileOf(body.profile);
  const urls = osrmRouteUrls(profile, o, d, options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  let lastFail: ResolveRouteFail = { ok: false, reason: "no_route" };

  for (const path of urls) {
    let response: Response;
    try {
      response = await fetchImpl(path, {
        method: "GET",
        headers: { accept: "application/json", "user-agent": USER_AGENT }
      });
    } catch (error) {
      lastFail = { ok: false, reason: "network_error", detail: { message: String(error), url: path } };
      continue;
    }
    if (!response.ok) {
      lastFail = {
        ok: false,
        reason: "osrm_http",
        detail: { status: response.status, url: path }
      };
      continue;
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      lastFail = { ok: false, reason: "osrm_parse", detail: { url: path } };
      continue;
    }
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      lastFail = { ok: false, reason: "osrm_parse", detail: { url: path } };
      continue;
    }
    const data = json as Record<string, unknown>;
    if (data.code !== "Ok" || !Array.isArray(data.routes) || !data.routes[0]) {
      lastFail = {
        ok: false,
        reason: "no_route",
        detail: { code: data.code, message: data.message, url: path }
      };
      continue;
    }
    const route = data.routes[0] as Record<string, unknown>;
    const distanceM =
      typeof route.distance === "number" && Number.isFinite(route.distance)
        ? Math.round(route.distance)
        : Math.round(haversineMeters(o, d));
    const durationS =
      typeof route.duration === "number" && Number.isFinite(route.duration)
        ? Math.round(route.duration)
        : 0;
    const geometry = route.geometry;
    const coordsRaw =
      geometry && typeof geometry === "object" && !Array.isArray(geometry)
        ? (geometry as Record<string, unknown>).coordinates
        : null;
    if (!Array.isArray(coordsRaw) || coordsRaw.length < 2) {
      lastFail = { ok: false, reason: "no_geometry", detail: { url: path } };
      continue;
    }
    const coordinates = thinRouteCoordinates(coordsRaw as number[][]);
    if (coordinates.length < 2) {
      lastFail = { ok: false, reason: "no_geometry", detail: { url: path } };
      continue;
    }
    return {
      ok: true,
      profile,
      distanceM,
      durationS,
      origin: o,
      destination: d,
      coordinates
    };
  }
  return lastFail;
}
