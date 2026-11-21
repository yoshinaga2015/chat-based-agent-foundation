import { describe, expect, it, vi } from "vitest";
import { browserFetch } from "./browser";

describe("browserFetch ladder", () => {
  it("静的が unusable なら rendered へエスカレーション", async () => {
    const rendered = vi.fn(async () => ({
      url: "https://example.com/q",
      markdown: "Close $213.66 on Oct 29, 2025. Volume was high.",
      truncated: false
    }));
    let renders = 0;
    const outcome = await browserFetch(
      0,
      "https://example.com/q",
      async () => ({
        url: "https://example.com/q",
        markdown: "Oops, something went wrong. Please try again.",
        truncated: false
      }),
      [],
      {
        rendered,
        rendersSoFar: 0,
        renderMax: 3,
        onRenderedAttempt: () => {
          renders += 1;
        }
      }
    );
    expect(outcome.ok).toBe(true);
    expect(rendered).toHaveBeenCalledOnce();
    expect(renders).toBe(1);
    if (outcome.ok) expect(outcome.result.markdown).toMatch(/213\.66/);
  });

  it("render 上限なら静的失敗のまま", async () => {
    const rendered = vi.fn();
    const outcome = await browserFetch(
      0,
      "https://example.com/q",
      async () => ({
        url: "https://example.com/q",
        markdown: "Oops, something went wrong.",
        truncated: false
      }),
      [],
      { rendered, rendersSoFar: 3, renderMax: 3 }
    );
    expect(outcome).toMatchObject({ ok: false, reason: "unusable_content" });
    expect(rendered).not.toHaveBeenCalled();
  });
});
