/** 地点間距離（ハバースイン）。resolve_places ツール用。 */

const R_M = 6_371_000;

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

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

export type ResolvedPlace = {
  id: string;
  title: string;
  distanceM: number;
  lat: number;
  lng: number;
  kind?: string;
  url?: string;
};

/** ツール本体。座標は引数で受け、距離だけ計算する（捏造しない）。 */
export function resolvePlaces(args: unknown): {
  ok: boolean;
  reason?: string;
  origin?: { lat: number; lng: number };
  places?: ResolvedPlace[];
} {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, reason: "invalid_args" };
  }
  const body = args as Record<string, unknown>;
  const origin = point(body.origin);
  if (!origin) return { ok: false, reason: "origin_required" };
  if (!Array.isArray(body.places) || body.places.length === 0) {
    return { ok: false, reason: "places_required" };
  }
  const out: ResolvedPlace[] = [];
  for (const row of body.places) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const item = row as Record<string, unknown>;
    const loc = point(item);
    if (!loc) continue;
    const title =
      typeof item.title === "string" && item.title.trim() ? item.title.trim() : null;
    if (!title) continue;
    const id =
      typeof item.id === "string" && item.id.trim()
        ? item.id.trim()
        : `${loc.lat.toFixed(5)},${loc.lng.toFixed(5)}`;
    const place: ResolvedPlace = {
      id,
      title,
      distanceM: Math.round(haversineMeters(origin, loc)),
      lat: loc.lat,
      lng: loc.lng
    };
    if (typeof item.kind === "string" && item.kind.trim()) place.kind = item.kind.trim();
    if (typeof item.url === "string" && item.url.startsWith("https://")) place.url = item.url;
    out.push(place);
    if (out.length >= 8) break;
  }
  out.sort((a, b) => a.distanceM - b.distanceM);
  if (!out.length) return { ok: false, reason: "no_valid_places" };
  return { ok: true, origin, places: out };
}
