import { describe, expect, it, vi } from "vitest";
import {
  browserClick,
  browserNavigate,
  browserRequestHandoff,
  browserScroll,
  browserSelect,
  browserSnapshot,
  isBrowserUnreachableConstraint,
  type BrowserSession
} from "./browserSession";
import { describeToolActivity, keepLastBrowserPreview } from "./activity";
import { productBrowserSession } from "./browserProduct";
import { createLocalBrowserSession } from "./browserLocal";
import { createSteelBrowserSession, steelInteractiveDebugUrl } from "./browserSteel";
import { patchSteelPlayerHtml, wrapSteelLivePlayerUrl } from "./browserSteelPlayer";

function mockSession(overrides: Partial<BrowserSession> = {}): BrowserSession {
  return {
    navigate: vi.fn(async (url) => ({ url, title: "T", text: "hello", truncated: false })),
    snapshot: vi.fn(async () => ({ url: "https://example.com/", title: "T", text: "snap", truncated: false })),
    click: vi.fn(async (_target) => ({ url: "https://example.com/", title: "T" })),
    type: vi.fn(async () => ({ url: "https://example.com/", title: "T" })),
    scroll: vi.fn(async () => ({ url: "https://example.com/", title: "T" })),
    select: vi.fn(async () => ({ url: "https://example.com/", title: "T" })),
    insertText: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => null),
    liveViewUrl: vi.fn(() => null),
    refreshLiveViewUrl: vi.fn(async () => null),
    detachForHandoff: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    ...overrides
  };
}

describe("browserSession ゲート", () => {
  it("未設定セッションは unavailable", async () => {
    await expect(browserNavigate(0, undefined, "https://example.com/")).resolves.toMatchObject({
      ok: false,
      reason: "unavailable"
    });
  });

  it("navigate 成功で snapshot 相当を返す", async () => {
    const session = mockSession();
    const outcome = await browserNavigate(0, session, "https://example.com/path");
    expect(outcome.ok).toBe(true);
    if (outcome.ok && "text" in outcome.result) {
      expect(outcome.result.text).toBe("hello");
    }
    expect(session.navigate).toHaveBeenCalled();
  });

  it("未 open の snapshot は not_open", async () => {
    await expect(browserSnapshot(0, mockSession(), false)).resolves.toMatchObject({
      ok: false,
      reason: "not_open"
    });
  });

  it("click は name か selector が要る", async () => {
    await expect(browserClick(0, mockSession(), true, "  ")).resolves.toMatchObject({
      ok: false,
      reason: "invalid_value"
    });
    await expect(browserClick(0, mockSession(), true, { name: "同意する" })).resolves.toMatchObject({
      ok: true
    });
  });

  it("click 後にプライベート URL なら閉じて拒否", async () => {
    const session = mockSession({
      click: vi.fn(async () => ({ url: "https://127.0.0.1/", title: "x" }))
    });
    await expect(browserClick(0, session, true, { name: "次へ" })).resolves.toMatchObject({
      ok: false,
      reason: "private_host"
    });
    expect(session.close).toHaveBeenCalled();
  });

  it("scroll / select は open 済みで呼ぶ", async () => {
    const session = mockSession();
    await expect(browserScroll(0, session, true, { direction: "down" })).resolves.toMatchObject({
      ok: true
    });
    await expect(
      browserSelect(0, session, true, { selector: "select#x", value: "1" })
    ).resolves.toMatchObject({ ok: true });
    expect(session.scroll).toHaveBeenCalled();
    expect(session.select).toHaveBeenCalled();
  });

  it("navigate timeout は unreachable を付ける", async () => {
    const session = mockSession({
      navigate: vi.fn(async () => {
        throw new Error("Navigation timeout of 25000 ms exceeded");
      })
    });
    await expect(browserNavigate(0, session, "https://www.chikamap.jp/")).resolves.toMatchObject({
      ok: false,
      reason: "act_error",
      detail: { unreachable: true }
    });
  });
});

describe("isBrowserUnreachableConstraint", () => {
  it("timeout / 522 / ERR_ を拾う", () => {
    expect(isBrowserUnreachableConstraint("Navigation timeout")).toBe(true);
    expect(isBrowserUnreachableConstraint("HTTP 522")).toBe(true);
    expect(isBrowserUnreachableConstraint("net::ERR_CONNECTION_TIMED_OUT")).toBe(true);
    expect(isBrowserUnreachableConstraint("selector not found")).toBe(false);
  });
});

describe("keepLastBrowserPreview", () => {
  it("ブラウザ操作の最終 preview だけ残す", () => {
    const rows = keepLastBrowserPreview([
      {
        id: "a1",
        name: "browser_navigate",
        kind: "browser",
        label: "開いた",
        status: "ok",
        ok: true,
        summary: "開いた",
        preview: { mime: "image/jpeg", base64: "aaa" },
        liveViewUrl: "https://live.example/1"
      },
      {
        id: "a2",
        name: "browser_click",
        kind: "browser",
        label: "クリックした",
        status: "ok",
        ok: true,
        summary: "クリックした",
        preview: { mime: "image/jpeg", base64: "bbb" }
      },
      {
        id: "a3",
        name: "web_search",
        kind: "search",
        label: "検索した",
        status: "ok",
        ok: true,
        summary: "検索した",
        preview: { mime: "image/jpeg", base64: "ccc" }
      }
    ]);
    expect(rows[0]?.preview).toBeUndefined();
    expect(rows[0]?.liveViewUrl).toBeUndefined();
    expect(rows[1]?.preview?.base64).toBe("bbb");
    expect(rows[2]?.preview).toBeUndefined();
  });
});

describe("browserBackendFromEnv", () => {
  it("cf エイリアスを認識", async () => {
    const { browserBackendFromEnv } = await import("./browserSession");
    expect(browserBackendFromEnv({ FUDO_BROWSER_BACKEND: "cf" })).toBe("cf");
    expect(browserBackendFromEnv({ FUDO_BROWSER_BACKEND: "browser-run" })).toBe("cf");
  });
});

describe("productBrowserSession", () => {
  it("off なら undefined", () => {
    expect(productBrowserSession({ FUDO_BROWSER_BACKEND: "off" })).toBeUndefined();
  });

  it("Workers 向け product は ACT_URL 無しだと undefined", () => {
    expect(productBrowserSession({ FUDO_BROWSER_BACKEND: "local" })).toBeUndefined();
    expect(
      productBrowserSession({ FUDO_BROWSER_BACKEND: "steel", STEEL_API_KEY: "ste-test" })
    ).toBeUndefined();
    expect(productBrowserSession({ FUDO_BROWSER_BACKEND: "cf" })).toBeUndefined();
  });

  it("Node local / steel ファクトリはセッションを返す", () => {
    expect(createLocalBrowserSession({})).toBeTypeOf("object");
    expect(createSteelBrowserSession({ STEEL_API_KEY: "ste-test" })).toBeTypeOf("object");
  });

  it("ACT_URL があれば HTTP セッション", () => {
    const session = productBrowserSession({
      FUDO_BROWSER_BACKEND: "local",
      FUDO_BROWSER_ACT_URL: "http://127.0.0.1:4176"
    });
    expect(session).toBeTypeOf("object");
  });
});

describe("browser-act sidecar factories", () => {
  it("local ファクトリ", () => {
    expect(createLocalBrowserSession({ FUDO_BROWSER_HEADED: "0" })).toBeTypeOf("object");
  });
});

describe("steelSessionNetworkFromEnv", () => {
  it("未設定は空（データセンター出口）", async () => {
    const { steelSessionNetworkFromEnv } = await import("./browserSteel");
    expect(steelSessionNetworkFromEnv({})).toEqual({});
  });

  it("BYOP が useProxy より優先", async () => {
    const { steelSessionNetworkFromEnv } = await import("./browserSteel");
    expect(
      steelSessionNetworkFromEnv({
        STEEL_PROXY_URL: "http://user:pass@proxy.example:8080",
        STEEL_USE_PROXY: "1"
      })
    ).toEqual({ proxyUrl: "http://user:pass@proxy.example:8080" });
  });

  it("STEEL_USE_PROXY は既定 JP", async () => {
    const { steelSessionNetworkFromEnv } = await import("./browserSteel");
    expect(steelSessionNetworkFromEnv({ STEEL_USE_PROXY: "1" })).toEqual({
      useProxy: { geolocation: { country: "JP" } }
    });
  });
});

describe("activity browser act", () => {
  it("navigate のホストをラベルに入れる", () => {
    const row = describeToolActivity("browser_navigate", { url: "https://example.com/a" }, "running");
    expect(row.label).toBe("example.com を開いています");
  });

  it("handoff のラベル", () => {
    expect(describeToolActivity("browser_request_handoff", { reason: "login" }, "running").label).toBe(
      "あなたに操作を渡しています"
    );
    expect(describeToolActivity("browser_request_handoff", { reason: "login" }, "ok").label).toBe(
      "あなたが操作中"
    );
  });
});

describe("steelInteractiveDebugUrl", () => {
  it("debugUrl に hideInteractionDialog を付ける（キー入力ゲート回避）", () => {
    expect(
      steelInteractiveDebugUrl({
        debugUrl: "https://api.steel.dev/v1/sessions/x/player/token"
      })
    ).toBe("https://api.steel.dev/v1/sessions/x/player/token?hideInteractionDialog=true");
  });

  it("無効な interactive クエリは落とす", () => {
    expect(
      steelInteractiveDebugUrl({
        debugUrl: "https://api.steel.dev/v1/sessions/x/player/token?interactive=true&showControls=true"
      })
    ).toBe("https://api.steel.dev/v1/sessions/x/player/token?hideInteractionDialog=true");
  });

  it("debugUrl が無ければ null（sessionViewerUrl には落とさない）", () => {
    expect(steelInteractiveDebugUrl({})).toBeNull();
  });
});

describe("wrapSteelLivePlayerUrl", () => {
  it("公開 base があれば /live-player に包む", () => {
    const raw = "https://api.steel.dev/v1/sessions/x/player/token?hideInteractionDialog=true";
    expect(wrapSteelLivePlayerUrl(raw, "https://fudo-browser-act.fly.dev")).toBe(
      `https://fudo-browser-act.fly.dev/live-player?src=${encodeURIComponent(raw)}`
    );
  });
});

describe("patchSteelPlayerHtml", () => {
  it("composition ハンドラを差し込む", () => {
    const stub = `<html><body><input id="hiddenInput" />
      <script>
        function sendTextInsert(text) {}
        function flushTextBuffer() {}
        function sendInteractionPayload() {}
        function interactionsEnabled() { return true; }
        let textBuffer = "";
        let pendingInsert = null;
        const hiddenInput = document.getElementById("hiddenInput");
        hiddenInput.addEventListener("beforeinput", (e) => {
          if (!interactionsEnabled()) {
            e.preventDefault();
            return;
          }
          if (e.data) {
            textBuffer += e.data;
            if (pendingInsert) cancelAnimationFrame(pendingInsert);
            pendingInsert = requestAnimationFrame(() => {
              flushTextBuffer();
              pendingInsert = null;
            });
          } else if (e.inputType === "deleteContentBackward") {
            flushTextBuffer();
            sendInteractionPayload({
              type: "keyboardEvent",
              event: {
                action: "keyPress",
                key: "Backspace",
                code: "Backspace",
                keyCode: 8,
                modifiers: 0,
              },
            });
          }
        });

        hiddenInput.addEventListener("input", () => {
          hiddenInput.value = "";
        });
      </script></body></html>`;
    const patched = patchSteelPlayerHtml(stub);
    expect(patched).toContain("imeComposing");
    expect(patched).toContain("compositionend");
    expect(patched).toContain("insertCompositionText");
  });
});

describe("isHandoffTaskEcho", () => {
  it("空・同一・task 内包をエコーとみなす", async () => {
    const { isHandoffTaskEcho } = await import("./browserSession");
    const task = "お手元のブラウザで全国地価マップを開き、完了を押してください。";
    expect(isHandoffTaskEcho("", task)).toBe(true);
    expect(isHandoffTaskEcho(task, task)).toBe(true);
    expect(isHandoffTaskEcho(`了解です。${task}`, task)).toBe(true);
    expect(isHandoffTaskEcho("別の短い返答です。", task)).toBe(false);
  });
});

describe("browserRequestHandoff", () => {
  it("Live View も local 面も無いと no_live_view", async () => {
    await expect(
      browserRequestHandoff(mockSession(), true, "login", "ログインして完了を押す")
    ).resolves.toMatchObject({
      ok: false,
      reason: "no_live_view"
    });
  });

  it("local 面 URL なら handoff できる", async () => {
    const { LOCAL_HANDOFF_SURFACE } = await import("./browserSession");
    const session = mockSession({
      liveViewUrl: vi.fn(() => LOCAL_HANDOFF_SURFACE),
      refreshLiveViewUrl: vi.fn(async () => LOCAL_HANDOFF_SURFACE)
    });
    await expect(
      browserRequestHandoff(session, true, "other", "前面道路の路線を選んだら完了を押す。", 10)
    ).resolves.toMatchObject({
      ok: true,
      result: { liveViewUrl: LOCAL_HANDOFF_SURFACE, reason: "other" }
    });
  });

  it("未 open（共有画面なし）は handoff しない", async () => {
    await expect(
      browserRequestHandoff(mockSession(), false, "other", "手元で地価マップを開き千代田区を調べたら完了。", 10, {
        allowUnopened: true
      })
    ).resolves.toMatchObject({ ok: false, reason: "not_open" });
  });

  it("Browser Run フォールバック面だけでは handoff しない", async () => {
    const { BROWSER_RUN_HANDOFF_SURFACE } = await import("./browserSession");
    const session = mockSession({
      liveViewUrl: vi.fn(() => BROWSER_RUN_HANDOFF_SURFACE),
      refreshLiveViewUrl: vi.fn(async () => BROWSER_RUN_HANDOFF_SURFACE)
    });
    await expect(
      browserRequestHandoff(session, true, "other", "前面道路の路線を選んだら完了を押す。", 10)
    ).resolves.toMatchObject({ ok: false, reason: "no_live_view" });
  });

  it("task が無いと invalid_value", async () => {
    const session = mockSession({
      liveViewUrl: vi.fn(() => "https://steel.dev/view/abc")
    });
    await expect(browserRequestHandoff(session, true, "login", "")).resolves.toMatchObject({
      ok: false,
      reason: "invalid_value"
    });
  });

  it("Steel URL があれば pending を返す", async () => {
    const session = mockSession({
      liveViewUrl: vi.fn(() => "https://steel.dev/view/abc"),
      refreshLiveViewUrl: vi.fn(async () => "https://steel.dev/view/abc")
    });
    await expect(
      browserRequestHandoff(session, true, "login", "ログインしてトップが見えたら完了を押す。", 100)
    ).resolves.toEqual({
      ok: true,
      result: {
        reason: "login",
        task: "ログインしてトップが見えたら完了を押す。",
        liveViewUrl: "https://steel.dev/view/abc",
        createdAt: 100,
        expiresAt: 100 + 15 * 60_000
      }
    });
  });

  it("キャッシュ空でも refresh で Live View が取れれば成功", async () => {
    const detach = vi.fn(async () => undefined);
    const session = mockSession({
      liveViewUrl: vi.fn(() => null),
      refreshLiveViewUrl: vi.fn(async () => "https://api.steel.dev/v1/sessions/x/player/t"),
      detachForHandoff: detach
    });
    await expect(
      browserRequestHandoff(session, true, "other", "地図の地点を選んだら完了を押す。", 50)
    ).resolves.toEqual({
      ok: true,
      result: {
        reason: "other",
        task: "地図の地点を選んだら完了を押す。",
        liveViewUrl: "https://api.steel.dev/v1/sessions/x/player/t",
        createdAt: 50,
        expiresAt: 50 + 10 * 60_000
      }
    });
    expect(detach).toHaveBeenCalledOnce();
  });
});

describe("handoff TTL", () => {
  it("isHandoffExpired は expiresAt を見る", async () => {
    const { isHandoffExpired, handoffExpiresAt } = await import("./browserSession");
    const createdAt = 1_000;
    const handoff = {
      reason: "captcha" as const,
      createdAt,
      expiresAt: handoffExpiresAt("captcha", createdAt)
    };
    expect(isHandoffExpired(handoff, createdAt + 4 * 60_000)).toBe(false);
    expect(isHandoffExpired(handoff, createdAt + 5 * 60_000)).toBe(true);
  });
});
