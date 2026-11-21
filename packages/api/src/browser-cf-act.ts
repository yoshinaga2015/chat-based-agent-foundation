/**
 * Browser Run（Workers Browser binding）上の操作セッション。
 * BrowserAct Durable Object 内でのみ使う（Node sidecar には載せない）。
 */
import puppeteer, {
  type Browser,
  type BrowserWorker,
  type Page
} from "@cloudflare/puppeteer";

export type CfActJson = Record<string, unknown>;

type CfRuntime = {
  browser: Browser | null;
  page: Page | null;
  sessionId: string | null;
  liveViewUrl: string | null;
};

const runtimes = new WeakMap<object, CfRuntime>();

/** DO 再起動後も同じ Browser Run セッションへ繋ぐ。 */
const SESSION_STORAGE_KEY = "cfBrowserSessionId";

/** keep_alive 上限（公式 20 分）。毎回 acquire しないための保険。 */
const KEEP_ALIVE_MS = 20 * 60_000;

type DoStorage = {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
};

function runtimeOf(owner: object): CfRuntime {
  let rt = runtimes.get(owner);
  if (!rt) {
    rt = { browser: null, page: null, sessionId: null, liveViewUrl: null };
    runtimes.set(owner, rt);
  }
  return rt;
}

function doStorage(owner: object): DoStorage | null {
  const storage = (owner as { ctx?: { storage?: DoStorage } }).ctx?.storage;
  return storage ?? null;
}

export function sessionCandidateIds(
  saved: string | null | undefined,
  listed: ReadonlyArray<{ sessionId?: string } | string>
): string[] {
  const out: string[] = [];
  const push = (id: string | null | undefined) => {
    const trimmed = typeof id === "string" ? id.trim() : "";
    if (!trimmed || out.includes(trimmed)) return;
    out.push(trimmed);
  };
  push(saved ?? null);
  for (const row of listed) {
    push(typeof row === "string" ? row : row.sessionId);
  }
  return out;
}

export function formatBrowserAcquireLimitError(
  waitMs: number,
  detail?: string
): string {
  const seconds = Math.max(1, Math.ceil(Math.max(0, waitMs) / 1000));
  const base = `Browser Run の取得制限（429）。約 ${seconds} 秒後に再試行できる。既存セッションにも接続できなかった。`;
  const extra = detail?.trim();
  return extra ? `${base} 詳細: ${extra.slice(0, 180)}` : base;
}

/** CF 取得枠・日次時間切れ。Steel 退避の判定に使う。 */
export function isBrowserRunAcquireLimitError(message: string): boolean {
  return /429|Rate limit|取得制限|Browser time limit exceeded/i.test(message);
}

export async function responseIndicatesBrowserAcquireLimit(
  response: Response
): Promise<boolean> {
  if (response.ok) return false;
  try {
    const data = (await response.clone().json()) as { error?: unknown };
    return typeof data.error === "string" && isBrowserRunAcquireLimitError(data.error);
  } catch {
    return false;
  }
}

export function workerBrowserMode(env: Env): "cf" | "steel" | null {
  const raw = (env.FUDO_BROWSER_BACKEND ?? "auto").trim().toLowerCase();
  if (raw === "off" || raw === "none" || raw === "false" || raw === "0") return null;
  if (raw === "cf" || raw === "browser-run" || raw === "browserrun") {
    return env.BROWSER ? "cf" : null;
  }
  if (raw === "steel") {
    return env.STEEL_API_KEY?.trim() ? "steel" : null;
  }
  if (raw === "auto" || raw === "" || raw === "local") {
    // 本番 Workers: Browser binding があれば本線。Steel は明示 or binding 無しの退避。
    if (env.BROWSER) return "cf";
    if (env.STEEL_API_KEY?.trim()) return "steel";
    return null;
  }
  return null;
}

export async function handleCfBrowserAct(
  owner: object,
  env: Env,
  request: Request
): Promise<Response> {
  if (!env.BROWSER) {
    return Response.json({ error: "BROWSER binding が無い" }, { status: 503 });
  }
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "GET" && path === "/health") {
    return new Response("ok", { headers: { "content-type": "text/plain" } });
  }
  if (request.method !== "POST") {
    return new Response(null, { status: 405 });
  }
  const token = env.FUDO_BROWSER_ACT_TOKEN?.trim() ?? "";
  if (token) {
    const auth = request.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${token}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  let body: CfActJson = {};
  try {
    body = (await request.json()) as CfActJson;
  } catch {
    body = {};
  }

  try {
    switch (path) {
      case "/navigate": {
        const target = typeof body.url === "string" ? body.url : "";
        if (!target) return Response.json({ error: "url required" }, { status: 400 });
        const page = await ensurePage(owner, env);
        await page.goto(target, { waitUntil: "domcontentloaded", timeout: 25_000 });
        // 後出し UI（CMP 等）は文言ではなく構造で待つ。採否は LLM が ## dialogs から選ぶ。
        await waitForInteractiveDialog(page, 12_000);
        await hydrateLiveView(owner, env, page);
        return Response.json(await snap(page));
      }
      case "/snapshot": {
        const page = await requirePage(owner, env);
        return Response.json(await snap(page));
      }
      case "/click": {
        const page = await requirePage(owner, env);
        await clickOn(page, {
          name: typeof body.name === "string" ? body.name : undefined,
          role: typeof body.role === "string" ? body.role : undefined,
          selector: typeof body.selector === "string" ? body.selector : undefined
        });
        await delay(200);
        await hydrateLiveView(owner, env, page);
        return Response.json({
          url: page.url(),
          title: await page.title().catch(() => "")
        });
      }
      case "/type": {
        const page = await requirePage(owner, env);
        const selector = typeof body.selector === "string" ? body.selector : "";
        const text = typeof body.text === "string" ? body.text : "";
        if (!selector) return Response.json({ error: "selector required" }, { status: 400 });
        await page.waitForSelector(selector, { timeout: 10_000 });
        await page.click(selector, { clickCount: 3 }).catch(() => undefined);
        await page.type(selector, text, { delay: 10 });
        if (body.submit === true) await page.keyboard.press("Enter");
        await delay(200);
        await hydrateLiveView(owner, env, page);
        return Response.json({
          url: page.url(),
          title: await page.title().catch(() => "")
        });
      }
      case "/scroll": {
        const page = await requirePage(owner, env);
        const direction = body.direction === "up" || body.direction === "down" ? body.direction : "";
        if (!direction) return Response.json({ error: "direction required" }, { status: 400 });
        const rawAmount = typeof body.amount === "number" ? body.amount : 600;
        const amount = Math.max(1, Math.min(rawAmount, 4000));
        const delta = direction === "up" ? -amount : amount;
        const selector = typeof body.selector === "string" ? body.selector.trim() : "";
        await page.evaluate(SCROLL_SCRIPT, { delta, selector });
        await delay(200);
        await hydrateLiveView(owner, env, page);
        return Response.json({
          url: page.url(),
          title: await page.title().catch(() => "")
        });
      }
      case "/select": {
        const page = await requirePage(owner, env);
        const selector = typeof body.selector === "string" ? body.selector.trim() : "";
        const value = typeof body.value === "string" ? body.value.trim() : "";
        const label = typeof body.label === "string" ? body.label.trim() : "";
        if (!selector) return Response.json({ error: "selector required" }, { status: 400 });
        if (!value && !label) return Response.json({ error: "value or label required" }, { status: 400 });
        await page.waitForSelector(selector, { timeout: 10_000 });
        if (value) {
          await page.select(selector, value);
        } else {
          const picked = (await page.evaluate(SELECT_BY_LABEL_SCRIPT, { selector, label })) as
            | string
            | null;
          if (picked == null) throw new Error("option not found");
        }
        await delay(200);
        await hydrateLiveView(owner, env, page);
        return Response.json({
          url: page.url(),
          title: await page.title().catch(() => "")
        });
      }
      case "/insert-text": {
        const page = await requirePage(owner, env);
        const text = typeof body.text === "string" ? body.text : "";
        if (!text) return Response.json({ error: "empty" }, { status: 400 });
        if (text.length > 2000) return Response.json({ error: "too_long" }, { status: 400 });
        // Workers の Keyboard に insertText が無い版があるため type で入れる。
        await page.keyboard.type(text, { delay: 5 });
        return Response.json({ ok: true });
      }
      case "/screenshot": {
        const page = await requirePage(owner, env);
        const buf = (await page.screenshot({
          type: "jpeg",
          quality: 60,
          encoding: "base64"
        })) as string;
        return Response.json({ mime: "image/jpeg", base64: buf });
      }
      case "/live-view": {
        const page = await requirePage(owner, env).catch(() => null);
        if (page) await hydrateLiveView(owner, env, page);
        return Response.json({ url: runtimeOf(owner).liveViewUrl });
      }
      case "/detach": {
        // Live View 操作中もセッションは残す。CF は structured handoff が本命。
        return Response.json({ detached: true });
      }
      case "/close": {
        await closeRuntime(owner);
        return Response.json({ closed: true });
      }
      default:
        return Response.json({ error: "not_found" }, { status: 404 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "cf_browser_act_failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

async function readPersistedSessionId(owner: object): Promise<string | null> {
  const storage = doStorage(owner);
  if (!storage) return null;
  const value = await storage.get(SESSION_STORAGE_KEY);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function persistSessionId(owner: object, sessionId: string | null): Promise<void> {
  const storage = doStorage(owner);
  if (!storage) return;
  if (sessionId) await storage.put(SESSION_STORAGE_KEY, sessionId);
  else await storage.delete(SESSION_STORAGE_KEY);
}

async function attachSession(
  owner: object,
  endpoint: BrowserWorker,
  sessionId: string
): Promise<Page> {
  const browser = await puppeteer.connect(endpoint, sessionId);
  const pages = await browser.pages().catch(() => [] as Page[]);
  const page = pages[0] ?? (await browser.newPage());
  page.setDefaultNavigationTimeout(25_000);
  const rt = runtimeOf(owner);
  rt.browser = browser;
  rt.page = page;
  rt.sessionId = sessionId;
  await persistSessionId(owner, sessionId);
  return page;
}

async function tryReuseSessions(owner: object, endpoint: BrowserWorker): Promise<Page | null> {
  const rt = runtimeOf(owner);
  const listed = await puppeteer.sessions(endpoint).catch(() => [] as Array<{ sessionId: string }>);
  const saved = rt.sessionId ?? (await readPersistedSessionId(owner));
  for (const sessionId of sessionCandidateIds(saved, listed)) {
    try {
      return await attachSession(owner, endpoint, sessionId);
    } catch {
      // 期限切れ・接続上限は次の候補へ
    }
  }
  return null;
}

async function readAcquireWaitMs(endpoint: BrowserWorker): Promise<number> {
  try {
    const quota = await puppeteer.limits(endpoint);
    return Math.max(0, quota.timeUntilNextAllowedBrowserAcquisition ?? 0);
  } catch {
    return 0;
  }
}

async function ensurePage(owner: object, env: Env): Promise<Page> {
  const rt = runtimeOf(owner);
  if (rt.page && rt.browser) return rt.page;
  if (!env.BROWSER) throw new Error("BROWSER binding が無い");
  const endpoint = env.BROWSER as BrowserWorker;

  const reused = await tryReuseSessions(owner, endpoint);
  if (reused) return reused;

  /** 短い取得制限は待って取り直す。長い日次上限は即エラー。 */
  const maxAttempts = 3;
  const maxWaitMs = 15_000;
  let lastWaitMs = 0;
  let lastDetail = "";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    lastWaitMs = await readAcquireWaitMs(endpoint);
    if (lastWaitMs > maxWaitMs) {
      throw new Error(formatBrowserAcquireLimitError(lastWaitMs, lastDetail || undefined));
    }
    if (attempt > 0 || lastWaitMs > 0) {
      const pause = Math.min(maxWaitMs, Math.max(lastWaitMs, attempt === 0 ? 0 : 1_000));
      if (pause > 0) await delay(pause);
      const again = await tryReuseSessions(owner, endpoint);
      if (again) return again;
    }
    try {
      const { sessionId } = await puppeteer.acquire(endpoint, { keep_alive: KEEP_ALIVE_MS });
      return await attachSession(owner, endpoint, sessionId);
    } catch (error) {
      lastDetail = error instanceof Error ? error.message : String(error);
      if (!/429|Rate limit/i.test(lastDetail)) throw error;
      lastWaitMs = Math.max(lastWaitMs, await readAcquireWaitMs(endpoint), 1_000);
    }
  }

  throw new Error(formatBrowserAcquireLimitError(lastWaitMs, lastDetail || undefined));
}

/**
 * snapshot / click 等: 開いているページが要る。
 * DO ハイバネで WeakMap が空でも、永続 sessionId へ再接続する（handoff 完了後の確認用）。
 * 新規 acquire はしない — セッションが無いなら「先に navigate」。
 */
export async function resolveAttachedPage<T>(
  memoryPage: T | null | undefined,
  reuse: () => Promise<T | null>
): Promise<T | null> {
  if (memoryPage) return memoryPage;
  return reuse();
}

async function requirePage(owner: object, env: Env): Promise<Page> {
  const rt = runtimeOf(owner);
  const memory = rt.page && rt.browser ? rt.page : null;
  const page = await resolveAttachedPage(memory, async () => {
    if (!env.BROWSER) return null;
    return tryReuseSessions(owner, env.BROWSER as BrowserWorker);
  });
  if (!page) throw new Error("先に navigate");
  return page;
}

async function closeRuntime(owner: object): Promise<void> {
  const rt = runtimeOf(owner);
  const browser = rt.browser;
  rt.browser = null;
  rt.page = null;
  rt.sessionId = null;
  rt.liveViewUrl = null;
  await persistSessionId(owner, null);
  if (browser) await browser.close().catch(() => undefined);
}

async function hydrateLiveView(owner: object, env: Env, page: Page): Promise<void> {
  const rt = runtimeOf(owner);
  rt.liveViewUrl = null;
  const expiresInMs = 15 * 60_000;
  const takeUrl = (value: unknown): string | null => {
    if (!value || typeof value !== "object") return null;
    const row = value as { devtoolsFrontendUrl?: unknown; url?: unknown };
    for (const key of ["devtoolsFrontendUrl", "url"] as const) {
      const raw = row[key];
      if (typeof raw === "string" && raw.trim().startsWith("http")) return raw.trim();
    }
    return null;
  };

  // 1) Binding API（remote Browser Run）
  try {
    const browser = env.BROWSER as BrowserWorker & {
      getLiveView?: (
        sessionId: string,
        options?: {
          mode?: string;
          expiresInMs?: number;
          targetId?: string;
          guardrails?: { mode?: string };
        }
      ) => Promise<unknown>;
    };
    if (rt.sessionId && typeof browser.getLiveView === "function") {
      const fromBinding = takeUrl(
        await browser.getLiveView(rt.sessionId, {
          mode: "tab",
          expiresInMs,
          // 閲覧専用。操作は handoff のみ。
          guardrails: { mode: "readonly" }
        })
      );
      if (fromBinding) {
        rt.liveViewUrl = fromBinding;
        return;
      }
      console.warn("[browser-cf] BROWSER.getLiveView returned no http url");
    } else {
      console.warn("[browser-cf] BROWSER.getLiveView unavailable", {
        hasSession: Boolean(rt.sessionId),
        hasMethod: typeof browser.getLiveView === "function"
      });
    }
  } catch (error) {
    console.warn(
      "[browser-cf] BROWSER.getLiveView failed:",
      error instanceof Error ? error.message : error
    );
  }

  // 2) CDP 拡張（ドキュメント記載の経路）
  try {
    const cdp = await page.createCDPSession();
    const fromCdp = takeUrl(
      await cdp.send(
        "Cloudflare.getLiveView" as "Cloudflare.getLiveView",
        {
          mode: "tab",
          expiresInMs,
          guardrails: { mode: "readonly" }
        } as never
      )
    );
    if (fromCdp) {
      rt.liveViewUrl = fromCdp;
      return;
    }
    console.warn("[browser-cf] CDP getLiveView returned no http url");
  } catch (error) {
    console.warn(
      "[browser-cf] CDP Cloudflare.getLiveView failed:",
      error instanceof Error ? error.message : error
    );
  }

  // 3) フォールバック（Banner のみ。共有 Live View URL は無し）
  rt.liveViewUrl = "fudo-browser-run://session";
}

/**
 * 後出しモーダル待ち。文言は見ない。
 * - role=dialog / alertdialog / aria-modal
 * - または高 z-index の fixed|sticky レイヤ（role 無し CMP 対策。日経など）
 * 空シェル・ヘッダー帯は除外。
 */
async function waitForInteractiveDialog(page: Page, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const hit = await page.evaluate(FIND_INTERACTIVE_DIALOG_SCRIPT);
    if (hit) {
      await delay(400);
      return;
    }
    await delay(250);
  }
}

/** dialog / モーダルレイヤ判定＋操作子有無（FIND / LIST で共有） */
const MODAL_HELPERS = `
  const norm = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const visible = (el, win) => {
    try {
      const st = win.getComputedStyle(el);
      if (st.visibility === "hidden" || st.display === "none" || st.opacity === "0") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch (_) {
      return true;
    }
  };
  const hasControl = (root) => {
    const doc = root.ownerDocument || document;
    const win = doc.defaultView || window;
    if (root.nodeType === 1 && !visible(root, win)) return false;
    const nodes = root.querySelectorAll
      ? root.querySelectorAll("button, a, [role='button'], input[type='button'], input[type='submit']")
      : [];
    for (const el of nodes) {
      if (!visible(el, win)) continue;
      const t = norm(el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || "");
      if (t) return true;
    }
    const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (const el of all) {
      if (el.shadowRoot && hasControl(el.shadowRoot)) return true;
    }
    return false;
  };
  const isAriaDialog = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const role = (el.getAttribute("role") || "").toLowerCase();
    return el.tagName === "DIALOG" || role === "dialog" || role === "alertdialog" || el.getAttribute("aria-modal") === "true";
  };
  const isModalLayer = (el, win) => {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === "HEADER" || tag === "NAV" || tag === "FOOTER") return false;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role === "banner" || role === "navigation" || role === "contentinfo") return false;
    try {
      const st = win.getComputedStyle(el);
      if (st.position !== "fixed" && st.position !== "sticky") return false;
      const z = parseInt(st.zIndex, 10);
      if (!Number.isFinite(z) || z < 1000) return false;
      if (!visible(el, win)) return false;
      const r = el.getBoundingClientRect();
      const vw = win.innerWidth || 1200;
      if (r.width < 160 || r.height < 72) return false;
      // 全幅の薄いトップバーは除外
      if (r.top < 64 && r.height < 96 && r.width > vw * 0.75) return false;
      return true;
    } catch (_) {
      return false;
    }
  };
  const collectModalRoots = (doc) => {
    const win = doc.defaultView || window;
    const roots = [];
    const seen = new Set();
    const push = (el) => {
      if (!el || seen.has(el)) return;
      if (!hasControl(el)) return;
      seen.add(el);
      roots.push(el);
    };
    for (const el of doc.querySelectorAll("dialog, [role='dialog'], [role='alertdialog'], [aria-modal='true']")) {
      push(el);
    }
    for (const el of doc.querySelectorAll("div, section, aside, form")) {
      if (isAriaDialog(el)) continue;
      if (isModalLayer(el, win)) push(el);
    }
    const walkShadow = (root) => {
      for (const el of root.querySelectorAll("*")) {
        if (!el.shadowRoot) continue;
        for (const inner of el.shadowRoot.querySelectorAll("dialog, [role='dialog'], [role='alertdialog'], [aria-modal='true']")) {
          push(inner);
        }
        for (const inner of el.shadowRoot.querySelectorAll("div, section, aside, form")) {
          if (isModalLayer(inner, win)) push(inner);
        }
        walkShadow(el.shadowRoot);
      }
    };
    walkShadow(doc);
    return roots;
  };
`;

const FIND_INTERACTIVE_DIALOG_SCRIPT = `(() => {
  ${MODAL_HELPERS}
  if (collectModalRoots(document).length) return true;
  for (const frame of document.querySelectorAll("iframe")) {
    try {
      const doc = frame.contentDocument;
      if (doc && collectModalRoots(doc).length) return true;
    } catch (_) {}
  }
  return false;
})()`;

const SCROLL_SCRIPT = `(arg) => {
  const delta = arg.delta;
  const selector = arg.selector || "";
  if (selector) {
    const el = document.querySelector(selector);
    if (el) {
      el.scrollBy(0, delta);
      return;
    }
  }
  window.scrollBy(0, delta);
}`;

const SELECT_BY_LABEL_SCRIPT = `(arg) => {
  const el = document.querySelector(arg.selector);
  if (!el || el.tagName !== "SELECT") return null;
  const want = arg.label;
  const opt = Array.from(el.options).find((o) => (o.textContent || "").trim() === want);
  if (!opt) return null;
  el.value = opt.value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return opt.value;
}`;

/** ## dialogs = ARIA dialog ＋高z fixed レイヤ。## actions = それ以外。文言リストなし。 */
const LIST_ACTIONS_SCRIPT = `(() => {
  ${MODAL_HELPERS}
  const collect = (root, bucket, seen) => {
    const doc = root.ownerDocument || document;
    const win = doc.defaultView || window;
    const nodes = root.querySelectorAll
      ? root.querySelectorAll("button, a, [role='button'], input[type='button'], input[type='submit']")
      : [];
    for (const el of nodes) {
      if (!visible(el, win)) continue;
      const t = norm(el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || "");
      if (!t || t.length > 80) continue;
      const role = (el.getAttribute("role") || (el.tagName === "A" ? "link" : "button")).toLowerCase();
      const key = role + "|" + t;
      if (seen.has(key)) continue;
      seen.add(key);
      bucket.push(role + " " + t);
      if (el.shadowRoot) collect(el.shadowRoot, bucket, seen);
    }
    const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (const el of all) {
      if (el.shadowRoot) collect(el.shadowRoot, bucket, seen);
    }
  };
  const dialogs = [];
  const rest = [];
  const seen = new Set();
  const roots = collectModalRoots(document);
  for (const d of roots) collect(d, dialogs, seen);
  collect(document, rest, seen);
  for (const frame of document.querySelectorAll("iframe")) {
    try {
      const doc = frame.contentDocument;
      if (!doc) continue;
      for (const d of collectModalRoots(doc)) collect(d, dialogs, seen);
      collect(doc, rest, seen);
    } catch (_) {}
  }
  const out = [];
  if (dialogs.length) {
    out.push("## dialogs");
    for (const line of dialogs.slice(0, 40)) out.push(line);
  }
  if (rest.length) {
    out.push("## actions");
    for (const line of rest.slice(0, 60)) out.push(line);
  }
  return out;
})()`;

async function snap(page: Page): Promise<{
  url: string;
  title: string;
  text: string;
  truncated: boolean;
}> {
  const url = page.url();
  const title = await page.title().catch(() => "");
  // dialog / 操作名を先に置く（ax が大きいと末尾が truncate で落ち、モデルが同意を見落とす）。
  let extras: string[] = [];
  try {
    const listed = await page.evaluate(LIST_ACTIONS_SCRIPT);
    if (Array.isArray(listed)) extras = listed.filter((x) => typeof x === "string");
  } catch {
    extras = [];
  }
  let body = "";
  try {
    const ax = await page.accessibility.snapshot();
    body = ax ? flattenAx(ax).slice(0, 6_000) : "";
  } catch {
    body = "";
  }
  if (!body.trim()) {
    const raw = await page.evaluate(
      "document.body && document.body.innerText ? document.body.innerText.slice(0, 6000) : ''"
    );
    body = typeof raw === "string" ? raw : "";
  }
  const parts: string[] = [];
  if (extras.length) parts.push(...extras, "");
  if (body.trim()) parts.push(body.trim());
  const text = parts.join("\n").slice(0, 10_000);
  return { url, title, text, truncated: text.length >= 10_000 };
}

function flattenAx(node: {
  name?: string;
  role?: string;
  children?: unknown[];
}): string {
  const parts: string[] = [];
  const walk = (n: { name?: string; role?: string; children?: unknown[] }) => {
    const label = [n.role, n.name].filter(Boolean).join(" ");
    if (label.trim()) parts.push(label.trim());
    for (const child of n.children ?? []) {
      if (child && typeof child === "object") walk(child as typeof n);
    }
  };
  walk(node);
  return parts.join("\n");
}

async function clickOn(
  page: Page,
  target: { name?: string; role?: string; selector?: string }
): Promise<void> {
  if (target.selector) {
    await page.waitForSelector(target.selector, { timeout: 10_000 });
    await page.click(target.selector);
    return;
  }
  const name = target.name?.trim();
  if (!name) throw new Error("name か selector が要る");
  const role = target.role?.trim() || "";
  // Shadow DOM / iframe 内も探す
  const clicked = await page.evaluate(
    `(() => {
      const n = ${JSON.stringify(name)};
      const r = ${JSON.stringify(role)};
      const norm = (s) => (s || "").replace(/\\s+/g, " ").trim();
      const want = norm(n).toLowerCase();
      const hit = (el) => {
        const text = norm(el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || "");
        const elRole = (el.getAttribute("role") || el.tagName.toLowerCase()).toLowerCase();
        if (r && !elRole.includes(r.toLowerCase()) && el.tagName.toLowerCase() !== r.toLowerCase()) return false;
        const t = text.toLowerCase();
        // 短いラベルへの過剰マッチを避ける（want ⊆ text のみ）
        return t === want || t.includes(want);
      };
      const walk = (root) => {
        const nodes = root.querySelectorAll
          ? root.querySelectorAll("button, a, [role='button'], input[type='button'], input[type='submit'], [onclick]")
          : [];
        for (const el of nodes) {
          if (hit(el)) { el.click(); return true; }
          if (el.shadowRoot && walk(el.shadowRoot)) return true;
        }
        const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
        for (const el of all) {
          if (el.shadowRoot && walk(el.shadowRoot)) return true;
        }
        return false;
      };
      if (walk(document)) return true;
      for (const frame of document.querySelectorAll("iframe")) {
        try {
          const doc = frame.contentDocument;
          if (doc && walk(doc)) return true;
        } catch (_) {}
      }
      return false;
    })()`
  );
  if (!clicked) throw new Error(`click_not_found:${name.slice(0, 40)}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
