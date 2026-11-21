import { describe, expect, it } from "vitest";
import { formatDistance, formatDuration, groupPlaceMapParts } from "./PlaceMap";
import type { UiPart } from "../types";

describe("formatDistance", () => {
  it("1km 未満は m", () => {
    expect(formatDistance(420)).toBe("420m");
  });
  it("1km 以上は km", () => {
    expect(formatDistance(1500)).toBe("1.5km");
  });
});

describe("formatDuration", () => {
  it("分と時間", () => {
    expect(formatDuration(900)).toBe("15分");
    expect(formatDuration(3900)).toBe("1時間5分");
  });
});

describe("groupPlaceMapParts", () => {
  it("隣接する place_list と map_snip をバンドルする", () => {
    const list: UiPart = {
      kind: "place_list",
      items: [{ id: "a", title: "A", distanceM: 10 }]
    };
    const map: UiPart = {
      kind: "map_snip",
      center: { lat: 1, lng: 2 },
      markers: [{ id: "a", lat: 1, lng: 2, label: "A" }]
    };
    const grouped = groupPlaceMapParts([list, map]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ kind: "place_map", list, map });
  });

  it("単独の map_snip はそのまま", () => {
    const map: UiPart = {
      kind: "map_snip",
      center: { lat: 1, lng: 2 },
      markers: []
    };
    expect(groupPlaceMapParts([map])).toEqual([map]);
  });

  it("chart をまたがない", () => {
    const list: UiPart = {
      kind: "place_list",
      items: [{ id: "a", title: "A", distanceM: 1 }]
    };
    const chart: UiPart = {
      kind: "chart",
      chartType: "line",
      series: [{ name: "n", data: [1, 2] }]
    };
    const map: UiPart = {
      kind: "map_snip",
      center: { lat: 1, lng: 2 },
      markers: [{ id: "a", lat: 1, lng: 2 }]
    };
    const grouped = groupPlaceMapParts([list, chart, map]);
    expect(grouped.map((p) => p.kind)).toEqual(["place_list", "chart", "map_snip"]);
  });
});
