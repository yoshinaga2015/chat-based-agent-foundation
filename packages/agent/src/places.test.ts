import { describe, expect, it } from "vitest";
import { haversineMeters, resolvePlaces } from "./places";
import { mapToolToUiParts } from "./uiParts";

describe("resolvePlaces", () => {
  it("距離を計算して近い順にする", () => {
    const result = resolvePlaces({
      origin: { lat: 35.6812, lng: 139.7671 },
      places: [
        { title: "遠い", lat: 35.71, lng: 139.81 },
        { title: "近い", lat: 35.682, lng: 139.768 }
      ]
    });
    expect(result.ok).toBe(true);
    expect(result.places?.[0]?.title).toBe("近い");
    expect(result.places?.[0]?.distanceM).toBeLessThan(result.places?.[1]?.distanceM ?? 0);
  });

  it("座標欠落は落とす", () => {
    const result = resolvePlaces({
      origin: { lat: 35.68, lng: 139.76 },
      places: [{ title: "無座標" }, { title: "有", lat: 35.681, lng: 139.761 }]
    });
    expect(result.places).toHaveLength(1);
  });
});

describe("haversineMeters", () => {
  it("同一点は0", () => {
    expect(haversineMeters({ lat: 1, lng: 2 }, { lat: 1, lng: 2 })).toBe(0);
  });
});

describe("mapToolToUiParts resolve_places", () => {
  it("place_list と map_snip を出す", () => {
    const parts = mapToolToUiParts("resolve_places", {}, {
      ok: true,
      origin: { lat: 35.68, lng: 139.76 },
      places: [
        { id: "a", title: "A", distanceM: 120, lat: 35.681, lng: 139.761 }
      ]
    });
    expect(parts.map((p) => p.kind)).toEqual(["place_list", "map_snip"]);
  });
});

describe("mapToolToUiParts resolve_route", () => {
  it("経路付き map_snip を出す", () => {
    const parts = mapToolToUiParts(
      "resolve_route",
      {},
      {
        ok: true,
        profile: "foot",
        distanceM: 1500,
        durationS: 1200,
        origin: { id: "o", title: "起点", lat: 35.68, lng: 139.76 },
        destination: { id: "d", title: "終点", lat: 35.69, lng: 139.77 },
        coordinates: [
          { lat: 35.68, lng: 139.76 },
          { lat: 35.685, lng: 139.765 },
          { lat: 35.69, lng: 139.77 }
        ]
      }
    );
    expect(parts.map((p) => p.kind)).toEqual(["place_list", "map_snip"]);
    const map = parts.find((p) => p.kind === "map_snip");
    expect(map?.kind === "map_snip" && map.route?.coordinates.length).toBe(3);
    expect(map?.kind === "map_snip" && map.route?.distanceM).toBe(1500);
  });

  it("ambiguous は経路なしの候補地図を出す", () => {
    const parts = mapToolToUiParts(
      "resolve_route",
      {},
      {
        ok: false,
        reason: "ambiguous",
        endpoint: "destination",
        query: "久光",
        origin: { id: "o", title: "起点", lat: 35.78, lng: 139.82 },
        candidates: [
          { id: "c1", title: "東京都足立区 久光", lat: 35.781, lng: 139.821 },
          { id: "c2", title: "北海道 久光", lat: 43.06, lng: 141.35 }
        ]
      }
    );
    expect(parts.map((p) => p.kind)).toEqual(["place_list", "map_snip"]);
    const list = parts.find((p) => p.kind === "place_list");
    const map = parts.find((p) => p.kind === "map_snip");
    expect(list?.kind === "place_list" && list.items).toHaveLength(2);
    expect(map?.kind === "map_snip" && map.route).toBeUndefined();
    expect(map?.kind === "map_snip" && map.markers.some((m) => m.id === "o")).toBe(true);
  });
});

describe("mapToolToUiParts run_calc（空のパック）", () => {
  it("計算結果の写像はパックが持つ。無ければ面を出さない", () => {
    expect(mapToolToUiParts("run_calc", { name: "x" }, { ok: true, yearly: { noi: [1, 2] } })).toEqual([]);
  });
});

describe("mapToolToUiParts web_search compare", () => {
  it("picks から compare_table を自動生成しない", () => {
    const parts = mapToolToUiParts("web_search", {}, {
      ok: true,
      results: [
        { title: "A", url: "https://a.example/", snippet: "s", meta: "¥1" },
        { title: "B", url: "https://b.example/", snippet: "t" }
      ]
    });
    expect(parts.map((p) => p.kind)).toEqual(["picks"]);
  });
});
