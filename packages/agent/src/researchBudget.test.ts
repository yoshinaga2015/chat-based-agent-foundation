import { describe, expect, it } from "vitest";
import { BROWSER_FETCH_PER_TURN, WEB_SEARCH_PER_TURN } from "./limits";
import { browserFetch } from "./browser";
import { webSearch } from "./search";

describe("web research budgets", () => {
  it("search / fetch は調査用に8回まで", () => {
    expect(WEB_SEARCH_PER_TURN).toBe(8);
    expect(BROWSER_FETCH_PER_TURN).toBe(8);
  });

  it("上限超過で limit を返す", () => {
    expect(webSearch(8, "q", () => [{ title: "a", url: "https://a.example/", snippet: "s" }])).toEqual({
      ok: false,
      reason: "limit"
    });
  });

  it("browser_fetch も上限で limit", async () => {
    const outcome = await browserFetch(8, "https://example.com/", async () => ({
      url: "https://example.com/",
      markdown: "x",
      truncated: false
    }));
    expect(outcome).toMatchObject({ ok: false, reason: "limit" });
  });
});
