import { DurableObject } from "cloudflare:workers";
import type { BrowserSession, BrowserSessionSnapshot } from "agent";
import { createHttpBrowserSession } from "agent";
import {
  handleCfBrowserAct,
  isBrowserRunAcquireLimitError,
  responseIndicatesBrowserAcquireLimit,
  workerBrowserMode
} from "./browser-cf-act";

/** CF 429 後はこの DO 内で Steel に寄せる（セッションは引き継がない。navigate からやり直し）。 */
const PREFER_STEEL_KEY = "preferSteelBackend";
/** ローカル HTTP Steel sidecar 退避。speak を跨いでも sticky。 */
const PREFER_STEEL_HTTP_KEY = "preferSteelHttp";

/**
 * browser-act:
 * - cf … Browser Run binding（一般本線）
 * - steel … Container + Steel CDP（例外・退避）
 * - cf で取得制限 → Steel に sticky 退避（STEEL_API_KEY + container があるとき）
 */
export class BrowserAct extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // withSteelHttpFallback が speak を跨いで sticky するためのフラグ。
    if (path === "/prefer-steel-http") {
      if (request.method === "GET") {
        const on = (await this.ctx.storage.get(PREFER_STEEL_HTTP_KEY)) === true;
        return Response.json({ on });
      }
      if (request.method === "POST") {
        const body = (await request.json().catch(() => ({}))) as { on?: unknown };
        if (body.on === true) await this.ctx.storage.put(PREFER_STEEL_HTTP_KEY, true);
        else await this.ctx.storage.delete(PREFER_STEEL_HTTP_KEY);
        return Response.json({ ok: true });
      }
      return new Response(null, { status: 405 });
    }

    const mode = workerBrowserMode(this.env);
    const preferSteel = (await this.ctx.storage.get(PREFER_STEEL_KEY)) === true;
    const canSteel = Boolean(this.env.STEEL_API_KEY?.trim() && this.ctx.container);

    if (request.method === "POST" && path === "/close") {
      await this.ctx.storage.delete(PREFER_STEEL_KEY);
      await this.ctx.storage.delete(PREFER_STEEL_HTTP_KEY);
    }

    if (mode === "cf" && !preferSteel) {
      // CF 側が body を読むので clone。429 時は元 request で Steel へ。
      const cfResponse = await handleCfBrowserAct(this, this.env, request.clone());
      if (canSteel && (await responseIndicatesBrowserAcquireLimit(cfResponse))) {
        await this.ctx.storage.put(PREFER_STEEL_KEY, true);
        return tagJsonBackend(await this.proxySteel(request), "steel");
      }
      return cfResponse;
    }

    if (mode === "cf" && preferSteel) {
      if (!canSteel) {
        return Response.json({ error: "steel_fallback_unavailable" }, { status: 503 });
      }
      return tagJsonBackend(await this.proxySteel(request), "steel");
    }

    if (mode !== "steel") {
      return Response.json({ error: "browser_backend_unavailable" }, { status: 503 });
    }

    return tagJsonBackend(await this.proxySteel(request), "steel");
  }

  private async proxySteel(request: Request): Promise<Response> {
    const container = this.ctx.container;
    if (!container) {
      return Response.json({ error: "container_unconfigured" }, { status: 503 });
    }
    try {
      if (!container.running) {
        const key = this.env.STEEL_API_KEY?.trim() ?? "";
        if (!key) {
          return Response.json({ error: "STEEL_API_KEY が無い" }, { status: 503 });
        }
        const actToken = this.env.FUDO_BROWSER_ACT_TOKEN?.trim() ?? "";
        if (!actToken) {
          return Response.json({ error: "FUDO_BROWSER_ACT_TOKEN が無い" }, { status: 503 });
        }
        const image = container.images?.["browser-act"];
        if (!image) {
          return Response.json({ error: "container_image_missing:browser-act" }, { status: 503 });
        }
        await container.start({
          image,
          enableInternet: true,
          env: {
            FUDO_BROWSER_BACKEND: "steel",
            STEEL_API_KEY: key,
            STEEL_BASE_URL: this.env.STEEL_BASE_URL?.trim() ?? "",
            STEEL_USE_PROXY: this.env.STEEL_USE_PROXY?.trim() ?? "",
            STEEL_PROXY_COUNTRY: this.env.STEEL_PROXY_COUNTRY?.trim() ?? "",
            STEEL_PROXY_URL: this.env.STEEL_PROXY_URL?.trim() ?? "",
            FUDO_BROWSER_ACT_TOKEN: actToken,
            FUDO_BROWSER_ACT_HOST: "0.0.0.0",
            FUDO_BROWSER_ACT_PORT: "4176"
          }
        });
        await waitHealthy(container, 90_000);
      }
      const port = container.getTcpPort(4176);
      const url = new URL(request.url);
      const target = new URL(url.pathname + url.search, "http://container/");
      return await port.fetch(target.toString(), request);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : "browser_act_do_failed";
      return Response.json({ error: message }, { status: 500 });
    }
  }
}

export function productBrowserSessionFromWorker(env: Env): BrowserSession | undefined {
  if (env.FUDO_BROWSER_ACT_URL?.trim()) {
    // 開発 sidecar / Fly。agent 側 HTTP クライアントが process.env 経由で持つ。
    return undefined;
  }
  if (!env.BROWSER_ACT) return undefined;
  if (!workerBrowserMode(env)) return undefined;
  return withSteelHttpFallback(env, createDoBrowserSession(env));
}

/** ローカル等: DO に Container が無いとき FUDO_BROWSER_STEEL_FALLBACK_URL の Steel sidecar へ。 */
function withSteelHttpFallback(env: Env, primary: BrowserSession): BrowserSession {
  const fallbackUrl = env.FUDO_BROWSER_STEEL_FALLBACK_URL?.trim() ?? "";
  if (!fallbackUrl || !env.STEEL_API_KEY?.trim()) return primary;
  const token = env.FUDO_BROWSER_ACT_TOKEN?.trim() ?? "";
  const steel = createHttpBrowserSession(fallbackUrl, { token: token || undefined });
  let active: BrowserSession = primary;
  let usingSteel = false;
  let routed = false;

  async function ensureRouted(): Promise<void> {
    if (routed) return;
    routed = true;
    if (await readPreferSteelHttp(env)) {
      usingSteel = true;
      active = steel;
    }
  }

  function markSteel<T>(value: T): T {
    if (!usingSteel || !value || typeof value !== "object") return value;
    return { ...(value as object), backend: "steel" } as T;
  }

  async function via<T>(run: (session: BrowserSession) => Promise<T>): Promise<T> {
    await ensureRouted();
    try {
      return markSteel(await run(active));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!usingSteel && isBrowserRunAcquireLimitError(message)) {
        usingSteel = true;
        active = steel;
        await writePreferSteelHttp(env, true).catch(() => undefined);
        return markSteel(await run(active));
      }
      throw error;
    }
  }

  return {
    navigate: (url) => via((s) => s.navigate(url)),
    snapshot: () => via((s) => s.snapshot()),
    click: (target) => via((s) => s.click(target)),
    type: (selector, text, submit) => via((s) => s.type(selector, text, submit)),
    scroll: (target) => via((s) => s.scroll(target)),
    select: (target) => via((s) => s.select(target)),
    insertText: (text) => via((s) => s.insertText(text)),
    screenshot: () => via((s) => s.screenshot()),
    liveViewUrl: () => active.liveViewUrl(),
    refreshLiveViewUrl: () => via((s) => s.refreshLiveViewUrl()),
    detachForHandoff: () => via((s) => s.detachForHandoff()),
    close: async () => {
      usingSteel = false;
      routed = true;
      const current = active;
      active = primary;
      await writePreferSteelHttp(env, false).catch(() => undefined);
      await current.close();
    }
  };
}

async function tagJsonBackend(response: Response, backend: "steel"): Promise<Response> {
  if (!response.ok) return response;
  const ct = response.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return response;
  try {
    const data = (await response.json()) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return Response.json(data, { status: response.status });
    }
    return Response.json({ ...(data as Record<string, unknown>), backend }, { status: response.status });
  } catch {
    return response;
  }
}

async function callBrowserActDo(
  env: Env,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<Response> {
  const id = env.BROWSER_ACT.idFromName("shared");
  const stub = env.BROWSER_ACT.get(id);
  const token = env.FUDO_BROWSER_ACT_TOKEN?.trim() ?? "";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return stub.fetch(`https://browser-act${path}`, {
    method: init?.method ?? "POST",
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body)
  });
}

/** speak を跨いだ HTTP Steel sticky。テストからも使う。 */
export async function readPreferSteelHttp(env: Env): Promise<boolean> {
  try {
    const response = await callBrowserActDo(env, "/prefer-steel-http", { method: "GET" });
    if (!response.ok) return false;
    const data = (await response.json().catch(() => ({}))) as { on?: unknown };
    return data.on === true;
  } catch {
    return false;
  }
}

export async function writePreferSteelHttp(env: Env, on: boolean): Promise<void> {
  const response = await callBrowserActDo(env, "/prefer-steel-http", {
    method: "POST",
    body: { on }
  });
  if (!response.ok) {
    throw new Error(`prefer_steel_http_${response.status}`);
  }
}

function createDoBrowserSession(env: Env): BrowserSession {
  async function call<T>(path: string, body?: unknown): Promise<T> {
    const id = env.BROWSER_ACT.idFromName("shared");
    const stub = env.BROWSER_ACT.get(id);
    const token = env.FUDO_BROWSER_ACT_TOKEN?.trim() ?? "";
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await stub.fetch(`https://browser-act${path}`, {
      method: "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string } & T;
    if (!response.ok) {
      throw new Error(typeof data.error === "string" ? data.error : `browser_act_do_${response.status}`);
    }
    return data;
  }

  let cachedLiveView: string | null = null;

  async function hydrateLiveView(): Promise<void> {
    try {
      const data = await call<{ url?: string | null }>("/live-view");
      cachedLiveView = typeof data.url === "string" && data.url.trim() ? data.url.trim() : null;
    } catch {
      cachedLiveView = null;
    }
  }

  return {
    async navigate(url) {
      const result = await call<BrowserSessionSnapshot>("/navigate", { url });
      await hydrateLiveView();
      return result;
    },
    snapshot: () => call<BrowserSessionSnapshot>("/snapshot"),
    click: (target) => call<{ url: string; title: string }>("/click", target),
    type: (selector, text, submit) =>
      call<{ url: string; title: string }>("/type", { selector, text, submit: submit === true }),
    scroll: (target) => call<{ url: string; title: string }>("/scroll", target),
    select: (target) => call<{ url: string; title: string }>("/select", target),
    async insertText(text) {
      await call<{ ok: true }>("/insert-text", { text });
    },
    async screenshot() {
      try {
        const data = await call<{ mime?: string; base64?: string }>("/screenshot");
        if (data.mime === "image/jpeg" && typeof data.base64 === "string" && data.base64) {
          return { mime: "image/jpeg" as const, base64: data.base64 };
        }
        return null;
      } catch {
        return null;
      }
    },
    liveViewUrl() {
      return cachedLiveView;
    },
    async refreshLiveViewUrl() {
      await hydrateLiveView();
      return cachedLiveView;
    },
    async detachForHandoff() {
      await call<{ detached: true }>("/detach");
    },
    close: async () => {
      cachedLiveView = null;
      await call<{ closed: true }>("/close");
    }
  };
}

async function waitHealthy(
  container: NonNullable<DurableObjectState["container"]>,
  ms: number
): Promise<void> {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < ms) {
    try {
      const port = container.getTcpPort(4176);
      const res = await port.fetch("http://container/health");
      if (res.ok) return;
      last = `http_${res.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : "not_ready";
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`browser_act_boot_timeout:${last.slice(0, 120)}`);
}
