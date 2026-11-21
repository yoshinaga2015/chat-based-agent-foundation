import { describe, expect, it, vi } from "vitest";
import { resolveRoute, thinRouteCoordinates } from "./route";

describe("thinRouteCoordinates", () => {
  it("間引いて始終点を残す", () => {
    const raw = Array.from({ length: 1000 }, (_, i) => [139 + i * 0.0001, 35 + i * 0.0001]);
    const thin = thinRouteCoordinates(raw, 100);
    expect(thin.length).toBeLessThanOrEqual(101);
    expect(thin[0]).toEqual({ lat: 35, lng: 139 });
    expect(thin.at(-1)?.lat).toBeCloseTo(35 + 999 * 0.0001, 5);
  });
});

describe("resolveRoute", () => {
  it("OSRM 成功レスポンスを経路に変換する", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          code: "Ok",
          routes: [
            {
              distance: 1234.5,
              duration: 900.2,
              geometry: {
                type: "LineString",
                coordinates: [
                  [139.7671, 35.6812],
                  [139.77, 35.682],
                  [139.7745, 35.683]
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const result = await resolveRoute(
      {
        origin: { lat: 35.6812, lng: 139.7671, title: "東京駅" },
        destination: { lat: 35.683, lng: 139.7745, title: "日本橋" },
        profile: "foot"
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, baseUrl: "https://osrm.test" }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.distanceM).toBe(1235);
    expect(result.durationS).toBe(900);
    expect(result.coordinates).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalled();
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toContain("139.7671,35.6812");
    expect(url).toMatch(/osrm\.test|openstreetmap\.de|project-osrm/);
  });

  it("先頭の経路 URL が失敗したら次へフォールバック", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("openstreetmap.de")) {
        return new Response("denied", { status: 403 });
      }
      return new Response(
        JSON.stringify({
          code: "Ok",
          routes: [
            {
              distance: 100,
              duration: 80,
              geometry: {
                type: "LineString",
                coordinates: [
                  [139.76, 35.68],
                  [139.77, 35.69]
                ]
              }
            }
          ]
        }),
        { status: 200 }
      );
    });
    const result = await resolveRoute(
      {
        origin: { lat: 35.68, lng: 139.76, title: "A" },
        destination: { lat: 35.69, lng: 139.77, title: "B" },
        profile: "foot"
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(result.ok).toBe(true);
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("住所だけでもジオコードしてから経路を取る", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("AddressSearch")) {
        const q = new URL(url).searchParams.get("q") ?? "";
        if (q.includes("クリニック")) return new Response("[]", { status: 200 });
        return new Response(
          JSON.stringify([
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [139.822, 35.7845] },
              properties: { title: "東京都足立区六町1-13-39" }
            }
          ]),
          { status: 200 }
        );
      }
      if (url.includes("/search?")) {
        const q = new URL(url).searchParams.get("q") ?? "";
        if (!q.includes("クリニック")) return new Response("[]", { status: 200 });
        return new Response(
          JSON.stringify([{ lat: "35.7860", lon: "139.8210", display_name: "六町駅クリニック" }]),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          code: "Ok",
          routes: [
            {
              distance: 400,
              duration: 300,
              geometry: {
                type: "LineString",
                coordinates: [
                  [139.822, 35.7845],
                  [139.821, 35.786]
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const result = await resolveRoute(
      {
        origin: { address: "足立区六町1-13-39" },
        destination: { address: "六町駅クリニック", title: "六町駅クリニック" },
        profile: "foot"
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        baseUrl: "https://osrm.test",
        geocodeBaseUrl: "https://nominatim.test",
        gsiUrl: "https://gsi.test/AddressSearch",
        geocodeGapMs: 0
      }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.origin.lat).toBeCloseTo(35.7845);
    expect(result.destination.title).toBe("六町駅クリニック");
    expect(result.distanceM).toBe(400);
  });

  it("目的地が複数候補なら経路を張らず ambiguous", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/search?") || url.includes("AddressSearch")) {
        return new Response(
          JSON.stringify([
            { lat: "35.781", lon: "139.821", display_name: "東京都足立区 久光" },
            { lat: "43.06", lon: "141.35", display_name: "北海道 久光" }
          ]),
          { status: 200 }
        );
      }
      throw new Error("OSRM を呼んではいけない");
    });
    const result = await resolveRoute(
      {
        origin: { lat: 35.7845, lng: 139.822, title: "起点" },
        destination: { address: "久光" },
        profile: "foot"
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        geocodeBaseUrl: "https://nominatim.test",
        gsiUrl: "https://gsi.test/AddressSearch",
        geocodeGapMs: 0
      }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("ambiguous");
    if (result.reason !== "ambiguous") return;
    expect(result.endpoint).toBe("destination");
    expect(result.candidates.length).toBeGreaterThanOrEqual(2);
    expect(result.candidates.some((c) => c.lat > 40)).toBe(true);
  });

  it("端点も住所も無いと失敗", async () => {
    const result = await resolveRoute({ origin: { lat: 1, lng: 2 }, destination: {} });
    expect(result.ok).toBe(false);
  });
});
