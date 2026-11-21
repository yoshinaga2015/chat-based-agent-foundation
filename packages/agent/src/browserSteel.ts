import { clickWithPlaywright } from "./browserClick";
import { insertTextIntoPage } from "./browserInsertText";
import type {
  BrowserClickTarget,
  BrowserScrollTarget,
  BrowserSelectTarget,
  BrowserSession,
  BrowserSessionSnapshot
} from "./browserSession";
import { screenshotPage } from "./browserScreenshot";
import { scrollOnPage, selectOnPage } from "./browserScrollSelect";
import { wrapSteelLivePlayerUrl } from "./browserSteelPlayer";

type PlaywrightModule = typeof import("playwright");
type Browser = import("playwright").Browser;
type Page = import("playwright").Page;

type SteelSessionCreated = {
  id: string;
  websocketUrl?: string;
  /** ダッシュボード（要 Steel ログイン）。handoff には使わない。 */
  sessionViewerUrl?: string;
  /** 認証不要の Live View。HITL／埋め込み用。 */
  debugUrl?: string;
};

/**
 * Steel Cloud（従量）。Playwright connectOverCDP。
 * CAPTCHA 自動解決は付けない。
 */
export function createSteelBrowserSession(
  env: Readonly<Record<string, string | undefined>> = {}
): BrowserSession {
  const apiKey = env["STEEL_API_KEY"]?.trim() ?? "";
  if (!apiKey) throw new Error("STEEL_API_KEY が無い");
  const base = (env["STEEL_BASE_URL"]?.trim() || "https://api.steel.dev").replace(/\/$/, "");

  let steelId: string | null = null;
  let viewerUrl: string | null = null;
  let websocketUrl: string | null = null;
  let browser: Browser | null = null;
  let page: Page | null = null;
  let closed = false;

  async function connectPage(sessionId: string, wsHint: string | null): Promise<Page> {
    const pw = await loadPlaywright();
    const ws =
      wsHint?.trim() ||
      `wss://connect.steel.dev?sessionId=${encodeURIComponent(sessionId)}`;
    const sep = ws.includes("?") ? "&" : "?";
    const cdp = `${ws}${sep}apiKey=${encodeURIComponent(apiKey)}`;
    browser = await pw.chromium.connectOverCDP(cdp);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(12_000);
    return page;
  }

  async function ensurePage(): Promise<Page> {
    if (closed) throw new Error("browser_session_closed");
    if (page) return page;
    if (steelId) {
      // handoff 後の再接続（同一 Steel セッション）
      try {
        return await connectPage(steelId, websocketUrl);
      } catch {
        // タイムアウト／手動 release 後は死んだ id のまま落ちる。捨てて新規。
        const b = browser;
        browser = null;
        page = null;
        steelId = null;
        websocketUrl = null;
        viewerUrl = null;
        if (b) await b.close().catch(() => undefined);
      }
    }
    const created = await createRemoteSession(base, apiKey, env);
    steelId = created.id;
    websocketUrl = created.websocketUrl?.trim() || null;
    viewerUrl = wrapSteelLivePlayerUrl(steelInteractiveDebugUrl(created), livePlayerPublicBase(env));
    return connectPage(steelId, websocketUrl);
  }

  async function snapOf(current: Page): Promise<BrowserSessionSnapshot> {
    const url = current.url();
    const title = await current.title().catch(() => "");
    const text = await accessibilityText(current);
    return { url, title, text, truncated: false };
  }

  return {
    async navigate(url) {
      const current = await ensurePage();
      await current.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await current
        .getByRole("dialog")
        .filter({ has: current.locator("button, a, [role='button']") })
        .first()
        .waitFor({ state: "visible", timeout: 12_000 })
        .catch(() => undefined);
      await delay(200);
      return snapOf(current);
    },
    async snapshot() {
      const current = await ensurePage();
      return snapOf(current);
    },
    async click(target: BrowserClickTarget) {
      const current = await ensurePage();
      await clickWithPlaywright(current, target);
      await delay(200);
      return { url: current.url(), title: await current.title().catch(() => "") };
    },
    async type(selector, text, submit = false) {
      const current = await ensurePage();
      const loc = current.locator(selector).first();
      await loc.fill(text, { timeout: 10_000 });
      if (submit) await loc.press("Enter");
      await delay(200);
      return { url: current.url(), title: await current.title().catch(() => "") };
    },
    async scroll(target: BrowserScrollTarget) {
      const current = await ensurePage();
      const result = await scrollOnPage(current, target);
      await delay(200);
      return result;
    },
    async select(target: BrowserSelectTarget) {
      const current = await ensurePage();
      const result = await selectOnPage(current, target);
      await delay(200);
      return result;
    },
    async insertText(text) {
      // handoff 中は新規セッションを作らない（Live View と別ページに打つ事故を防ぐ）
      if (closed) throw new Error("browser_session_closed");
      if (!steelId) throw new Error("browser_session_not_open");
      let current = page;
      if (current) {
        try {
          await current.evaluate(() => true);
        } catch {
          const b = browser;
          browser = null;
          page = null;
          if (b) await b.close().catch(() => undefined);
          current = null;
        }
      }
      if (!current) {
        try {
          current = await connectPage(steelId, websocketUrl);
          await current.evaluate(() => true);
        } catch {
          const b = browser;
          browser = null;
          page = null;
          if (b) await b.close().catch(() => undefined);
          throw new Error("browser_session_stale");
        }
      }
      await insertTextIntoPage(current, text);
    },
    async screenshot() {
      if (!page || closed) return null;
      return screenshotPage(page);
    },
    liveViewUrl() {
      return viewerUrl;
    },
    async refreshLiveViewUrl() {
      return viewerUrl;
    },
    async detachForHandoff() {
      const b = browser;
      browser = null;
      page = null;
      if (b) await b.close().catch(() => undefined);
    },
    async close() {
      closed = true;
      const b = browser;
      const id = steelId;
      browser = null;
      page = null;
      steelId = null;
      websocketUrl = null;
      viewerUrl = null;
      if (b) await b.close().catch(() => undefined);
      if (id) await releaseRemoteSession(base, apiKey, id).catch(() => undefined);
      // 同一プロセスで開き直せる（sidecar がインスタンスを使い回す場合）
      closed = false;
    }
  };
}

export function steelKeyFromEnv(
  env: Readonly<Record<string, string | undefined>> = {}
): string | undefined {
  const key = env["STEEL_API_KEY"]?.trim();
  return key || undefined;
}

/**
 * app.steel.dev の sessionViewerUrl はログイン必須。debugUrl が操作引き継ぎ用。
 * WebRTC プレイヤーが認識するクエリは hideOverlay / hideInteractionDialog のみ。
 * interactive=true 等は無視される。ゲートを出さないとキー入力が preventDefault される。
 */
export function steelInteractiveDebugUrl(created: Pick<SteelSessionCreated, "debugUrl">): string | null {
  const raw = created.debugUrl?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.searchParams.delete("interactive");
    url.searchParams.delete("showControls");
    url.searchParams.set("hideInteractionDialog", "true");
    return url.toString();
  } catch {
    const join = raw.includes("?") ? "&" : "?";
    return `${raw}${join}hideInteractionDialog=true`;
  }
}

function livePlayerPublicBase(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const explicit = env["FUDO_BROWSER_ACT_PUBLIC_URL"]?.trim();
  if (explicit) return explicit;
  // ローカル／Fly sidecar の公開口。Workers から見える ACT_URL と同じでよい。
  return env["FUDO_BROWSER_ACT_URL"]?.trim();
}

/**
 * Steel セッションの出口 IP。
 * - `STEEL_PROXY_URL` … BYOP（最優先）
 * - `STEEL_USE_PROXY=1` … Steel 管理プロキシ（Launch はデポジット要。既定国は JP）
 * 未設定ならデータセンター出口（日本の公的サイトに届かないことがある）。
 */
export function steelSessionNetworkFromEnv(
  env: Readonly<Record<string, string | undefined>> = {}
): Record<string, unknown> {
  const proxyUrl = env["STEEL_PROXY_URL"]?.trim() || env["FUDO_STEEL_PROXY_URL"]?.trim();
  if (proxyUrl) return { proxyUrl };
  if (!/^(1|true|yes)$/i.test(env["STEEL_USE_PROXY"]?.trim() ?? "")) return {};
  const country = (env["STEEL_PROXY_COUNTRY"]?.trim() || "JP").toUpperCase();
  if (/^[A-Z]{2}$/.test(country)) {
    return { useProxy: { geolocation: { country } } };
  }
  return { useProxy: true };
}

async function createRemoteSession(
  base: string,
  apiKey: string,
  env: Readonly<Record<string, string | undefined>> = {}
): Promise<SteelSessionCreated> {
  const response = await fetch(`${base}/v1/sessions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "steel-api-key": apiKey,
      accept: "application/json",
      "user-agent": "fudo-browser-act/1.0"
    },
    body: JSON.stringify({
      // handoff 中のユーザー操作を見込む
      timeout: 600_000,
      inactivityTimeout: 300_000,
      debugConfig: { interactive: true, systemCursor: true },
      ...steelSessionNetworkFromEnv(env)
    })
  });
  const data = (await response.json().catch(() => ({}))) as SteelSessionCreated & { error?: string; message?: string };
  if (!response.ok || !data.id) {
    throw new Error(
      typeof data.message === "string"
        ? data.message.slice(0, 200)
        : typeof data.error === "string"
          ? data.error.slice(0, 200)
          : `steel_session_http_${response.status}`
    );
  }
  return data;
}

async function releaseRemoteSession(base: string, apiKey: string, id: string): Promise<void> {
  const response = await fetch(`${base}/v1/sessions/${encodeURIComponent(id)}/release`, {
    method: "POST",
    headers: {
      "steel-api-key": apiKey,
      "user-agent": "fudo-browser-act/1.0"
    }
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`steel_release_http_${response.status}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadPlaywright(): Promise<PlaywrightModule> {
  try {
    return await import("playwright");
  } catch {
    throw new Error("playwright が無い。packages/agent で pnpm add playwright");
  }
}

async function accessibilityText(page: Page): Promise<string> {
  try {
    const aria = await page.locator("body").ariaSnapshot({ timeout: 5_000 });
    if (aria?.trim()) return aria;
  } catch {
    // fall through
  }
  const body = await page.locator("body").innerText().catch(() => "");
  return body.slice(0, 10_000);
}
