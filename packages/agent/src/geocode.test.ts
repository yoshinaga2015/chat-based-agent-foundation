import { describe, expect, it, vi } from "vitest";
import {
  areaHintsFromLabel,
  geocodeAddress,
  geocodeCandidates,
  looksLikeJapaneseAddress,
  rankCandidatesNear
} from "./geocode";

describe("looksLikeJapaneseAddress", () => {
  it("番地付きは住所", () => {
    expect(looksLikeJapaneseAddress("足立区六町1-13-39")).toBe(true);
    expect(looksLikeJapaneseAddress("東京都足立区六町一丁目13番")).toBe(true);
  });
  it("施設名だけは住所ではない", () => {
    expect(looksLikeJapaneseAddress("六町駅クリニック")).toBe(false);
  });
});

describe("rankCandidatesNear", () => {
  it("近い順に並べるが遠い候補は残す", () => {
    const near = { lat: 35.78, lng: 139.82 };
    const ranked = rankCandidatesNear(
      [
        {
          id: "far",
          lat: 43.06,
          lng: 141.35,
          label: "北海道",
          query: "久光",
          source: "gsi"
        },
        {
          id: "near",
          lat: 35.781,
          lng: 139.821,
          label: "足立",
          query: "久光",
          source: "nominatim"
        }
      ],
      near
    );
    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.id).toBe("near");
    expect(ranked[1]?.id).toBe("far");
  });
});

describe("areaHintsFromLabel", () => {
  it("区名を取り出す", () => {
    expect(areaHintsFromLabel("東京都足立区六町1-13-39")).toContain("東京都足立区");
  });
});

describe("geocodeCandidates", () => {
  it("複数ヒットを落とさず返す", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("AddressSearch")) {
        return new Response(
          JSON.stringify([
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [141.35, 43.06] },
              properties: { title: "北海道久光" }
            }
          ]),
          { status: 200 }
        );
      }
      if (url.includes("/search?")) {
        return new Response(
          JSON.stringify([
            { lat: "35.781", lon: "139.821", display_name: "東京都足立区 久光" },
            { lat: "43.06", lon: "141.35", display_name: "北海道 久光" }
          ]),
          { status: 200 }
        );
      }
      return new Response("[]", { status: 200 });
    });
    const result = await geocodeCandidates("久光", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      gsiUrl: "https://gsi.test/AddressSearch",
      baseUrl: "https://nominatim.test",
      near: { lat: 35.78, lng: 139.82 },
      areaHints: ["東京都足立区"]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.places.length).toBeGreaterThanOrEqual(2);
    expect(result.places.some((p) => p.lat > 40)).toBe(true);
    expect(result.places.some((p) => p.lat < 36)).toBe(true);
  });
});

describe("geocodeAddress", () => {
  it("番地は GSI を先に使う", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("msearch.gsi.go.jp") || url.includes("AddressSearch")) {
        return new Response(
          JSON.stringify([
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [139.822205, 35.783516] },
              properties: { title: "東京都足立区六町一丁目１３番" }
            }
          ]),
          { status: 200 }
        );
      }
      return new Response("[]", { status: 200 });
    });
    const result = await geocodeAddress("足立区六町1-13-39", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      gsiUrl: "https://msearch.gsi.go.jp/address-search/AddressSearch",
      baseUrl: "https://nominatim.test"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.place.source).toBe("gsi");
    expect(result.place.lat).toBeCloseTo(35.783516);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("AddressSearch");
  });

  it("施設名は Nominatim を先に使う", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/search?")) {
        return new Response(
          JSON.stringify([{ lat: "35.7855", lon: "139.8216", display_name: "六町駅クリニック" }]),
          { status: 200 }
        );
      }
      // 一意性のため GSI は空（両方ヒットすると候補化）
      return new Response("[]", { status: 200 });
    });
    const result = await geocodeAddress("六町駅クリニック", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      gsiUrl: "https://msearch.gsi.go.jp/address-search/AddressSearch",
      baseUrl: "https://nominatim.test"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.place.source).toBe("nominatim");
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("/search?");
  });

  it("複数候補は一意確定しない", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify([
          { lat: "35.78", lon: "139.82", display_name: "A" },
          { lat: "43.06", lon: "141.35", display_name: "B" }
        ]),
        { status: 200 }
      )
    );
    const result = await geocodeAddress("久光", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      gsiUrl: "https://gsi.test/AddressSearch",
      baseUrl: "https://nominatim.test"
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toMatchObject({ ambiguous: true });
  });

  it("空クエリは拒否", async () => {
    expect(await geocodeAddress("  ")).toMatchObject({ ok: false, reason: "query_required" });
  });
});
