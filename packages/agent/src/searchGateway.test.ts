import { afterEach, describe, expect, it } from "vitest";
import { installAi, type AiBinding } from "./config";
import {
  cloudflareWebSearch,
  hitsMatchQuery,
  productSearch,
  providersForQuery,
  tavilyWebSearch,
  WEB_SEARCH_PROVIDERS
} from "./searchGateway";

function searchAi(respond: (provider: string | undefined) => Response, calls: string[] = []): AiBinding {
  return {
    run: async () => ({}),
    websearch: async (request) => {
      calls.push(request.provider ?? "");
      return respond(request.provider);
    }
  };
}

afterEach(() => installAi(null));

describe("Web検索アダプタ", () => {
  it("日本語クエリは Linkup を先にする", () => {
    expect(providersForQuery("住宅ローン金利")).toEqual(["linkup", "exa", "ceramic"]);
    expect(providersForQuery("mortgage rate")).toEqual(["ceramic", "exa", "linkup"]);
  });

  it("日本語クエリに英字ばかりの結果は不一致", () => {
    expect(hitsMatchQuery("住宅ローン", [
      { url: "https://a.example", title: "color hex", snippet: "RGB" }
    ])).toBe(false);
    expect(hitsMatchQuery("住宅ローン", [
      { url: "https://a.example", title: "金利情報", snippet: "変動金利" }
    ])).toBe(true);
  });

  it("Cloudflare の items を SearchHit に写す", async () => {
    const search = cloudflareWebSearch(searchAi(() =>
      new Response(JSON.stringify({
        items: [{ url: "https://example.com/a", title: "甲", description: "要約です" }]
      }), { status: 200 })));
    await expect(search("不動産")).resolves.toEqual([
      { url: "https://example.com/a", title: "甲", snippet: "要約です" }
    ]);
  });

  it("日本語でノイズなら次のプロバイダへ", async () => {
    const calls: string[] = [];
    installAi(searchAi((provider) => provider === "linkup"
      ? new Response(JSON.stringify({
          items: [{ url: "https://noise.example", title: "hex color", description: "RGB" }]
        }), { status: 200 })
      : new Response(JSON.stringify({
          items: [{ url: "https://exa.example/b", title: "金利情報", description: "変動金利の動向" }]
        }), { status: 200 }), calls));
    const search = productSearch({});
    await expect(search("住宅ローン金利")).resolves.toEqual([
      { url: "https://exa.example/b", title: "金利情報", snippet: "変動金利の動向" }
    ]);
    expect(calls).toEqual(["linkup", "exa"]);
  });

  it("Cloudflare 全プロバイダ失敗後に Tavily へ落ちる", async () => {
    const calls: string[] = [];
    installAi(searchAi(() => new Response("no", { status: 402 }), calls));
    const search = productSearch({ TAVILY_API_KEY: "tvly" }, async () =>
      new Response(JSON.stringify({
        results: [{ url: "https://tavily.example/b", title: "乙", content: "代替" }]
      }), { status: 200 }));
    await expect(search("mortgage")).resolves.toEqual([
      { url: "https://tavily.example/b", title: "乙", snippet: "代替" }
    ]);
    expect(calls).toHaveLength(WEB_SEARCH_PROVIDERS.length);
  });

  it("バインディングも Tavily も無ければ空", async () => {
    await expect(productSearch({}, async () => new Response("no"))("x")).resolves.toEqual([]);
  });

  it("Tavily 単体でも写せる", async () => {
    const search = tavilyWebSearch("k", async () =>
      new Response(JSON.stringify({
        results: [{ url: "https://t.example", title: "丙", content: "本文" }]
      }), { status: 200 }));
    await expect(search("q")).resolves.toEqual([
      { url: "https://t.example", title: "丙", snippet: "本文" }
    ]);
  });
});
