import { describe, expect, it, vi } from "vitest";
import {
  formatBrowserAcquireLimitError,
  isBrowserRunAcquireLimitError,
  resolveAttachedPage,
  sessionCandidateIds,
  workerBrowserMode
} from "./browser-cf-act";

function env( partial: Partial<Env> ): Env {
  return partial as Env;
}

describe("sessionCandidateIds", () => {
  it("保存 ID を先頭にし、重複を落とす", () => {
    expect(
      sessionCandidateIds("saved", [{ sessionId: "a" }, { sessionId: "saved" }, "b", "a"])
    ).toEqual(["saved", "a", "b"]);
  });

  it("空は無視", () => {
    expect(sessionCandidateIds("  ", [{ sessionId: "" }, { sessionId: "x" }])).toEqual(["x"]);
  });
});

describe("resolveAttachedPage", () => {
  it("メモリにあれば reuse しない（handoff 中の同一 speak）", async () => {
    const reuse = vi.fn(async () => "reused");
    await expect(resolveAttachedPage("memory", reuse)).resolves.toBe("memory");
    expect(reuse).not.toHaveBeenCalled();
  });

  it("メモリが空なら永続セッションへ再接続（DO ハイバネ後の snapshot）", async () => {
    const reuse = vi.fn(async () => "reused");
    await expect(resolveAttachedPage(null, reuse)).resolves.toBe("reused");
    expect(reuse).toHaveBeenCalledOnce();
  });

  it("再接続先も無ければ null（先に navigate）", async () => {
    await expect(resolveAttachedPage(undefined, async () => null)).resolves.toBeNull();
  });
});

describe("formatBrowserAcquireLimitError", () => {
  it("待ち秒を切り上げる", () => {
    expect(formatBrowserAcquireLimitError(1500)).toMatch(/約 2 秒後/);
  });
});

describe("isBrowserRunAcquireLimitError", () => {
  it("429 / 取得制限 / 日次切れを拾う", () => {
    expect(isBrowserRunAcquireLimitError("Unable to create new browser: code: 429: message: Rate limit exceeded")).toBe(
      true
    );
    expect(isBrowserRunAcquireLimitError("Browser Run の取得制限（429）。約 1 秒後")).toBe(true);
    expect(isBrowserRunAcquireLimitError("Browser time limit exceeded for today")).toBe(true);
    expect(isBrowserRunAcquireLimitError("timeout")).toBe(false);
  });
});

describe("workerBrowserMode", () => {
  it("off は null", () => {
    expect(workerBrowserMode(env({ FUDO_BROWSER_BACKEND: "off", BROWSER: {} as Env["BROWSER"] }))).toBeNull();
  });

  it("cf は BROWSER binding が要る", () => {
    expect(workerBrowserMode(env({ FUDO_BROWSER_BACKEND: "cf" }))).toBeNull();
    expect(workerBrowserMode(env({ FUDO_BROWSER_BACKEND: "cf", BROWSER: {} as Env["BROWSER"] }))).toBe(
      "cf"
    );
  });

  it("steel は API キーが要る", () => {
    expect(workerBrowserMode(env({ FUDO_BROWSER_BACKEND: "steel" }))).toBeNull();
    expect(
      workerBrowserMode(env({ FUDO_BROWSER_BACKEND: "steel", STEEL_API_KEY: "ste-x" }))
    ).toBe("steel");
  });

  it("auto は BROWSER を steel より優先", () => {
    expect(
      workerBrowserMode(
        env({
          FUDO_BROWSER_BACKEND: "auto",
          BROWSER: {} as Env["BROWSER"],
          STEEL_API_KEY: "ste-x"
        })
      )
    ).toBe("cf");
    expect(workerBrowserMode(env({ FUDO_BROWSER_BACKEND: "auto", STEEL_API_KEY: "ste-x" }))).toBe(
      "steel"
    );
  });
});
