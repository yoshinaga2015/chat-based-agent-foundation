import type {
  BrowserClickTarget,
  BrowserScrollTarget,
  BrowserSelectTarget,
  BrowserSession,
  BrowserSessionSnapshot
} from "./browserSession";
import { LOCAL_HANDOFF_SURFACE } from "./browserSession";
import { clickWithPlaywright } from "./browserClick";
import { insertTextIntoPage } from "./browserInsertText";
import { screenshotPage } from "./browserScreenshot";
import { scrollOnPage, selectOnPage } from "./browserScrollSelect";

type PlaywrightModule = typeof import("playwright");
type Browser = import("playwright").Browser;
type Page = import("playwright").Page;

/** Node／sidecar 専用のローカル Chromium。Workers は productBrowserSession（HTTP）を使う。 */

export function createLocalBrowserSession(
  env: Readonly<Record<string, string | undefined>> = {}
): BrowserSession {
  const headed = /^(1|true|yes)$/i.test(env["FUDO_BROWSER_HEADED"]?.trim() ?? "");
  let browser: Browser | null = null;
  let page: Page | null = null;
  let closed = false;

  async function ensurePage(): Promise<Page> {
    if (closed) throw new Error("browser_session_closed");
    if (page) return page;
    const pw = await loadPlaywright();
    browser = await pw.chromium.launch({
      headless: !headed,
      args: ["--disable-dev-shm-usage"]
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent:
        "Mozilla/5.0 (compatible; fudo-browser-act/1.0; +https://example.invalid) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
    });
    page = await context.newPage();
    page.setDefaultTimeout(12_000);
    return page;
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
      // 後出し modal。文言は見ない（採否は agent）。空 dialog シェルは除外しにくいので role 待ち＋短settle。
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
      const current = await ensurePage();
      await insertTextIntoPage(current, text);
    },
    async screenshot() {
      if (!page || closed) return null;
      return screenshotPage(page);
    },
    liveViewUrl() {
      // Steel の URL は無い。handoff はローカルウィンドウを操作面にする。
      return LOCAL_HANDOFF_SURFACE;
    },
    async refreshLiveViewUrl() {
      return LOCAL_HANDOFF_SURFACE;
    },
    async detachForHandoff() {
      // CDP は残す（local は同一プロセスのウィンドウが操作面）。
    },
    async close() {
      closed = true;
      const b = browser;
      browser = null;
      page = null;
      if (b) await b.close().catch(() => undefined);
    }
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadPlaywright(): Promise<PlaywrightModule> {
  try {
    return await import("playwright");
  } catch {
    throw new Error("playwright が無い。packages/agent で pnpm add playwright && npx playwright install chromium");
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
