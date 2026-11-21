import type {
  BrowserClickTarget,
  BrowserScrollTarget,
  BrowserSelectTarget,
  BrowserSession,
  BrowserSessionSnapshot
} from "./browserSession";
import type { BrowserScreenshot } from "./browserScreenshot";

export type HttpBrowserSessionOptions = {
  fetchImpl?: typeof fetch;
  /** Fly 等の公開 URL 用。未設定なら Authorization を付けない（ローカル sidecar）。 */
  token?: string;
};

/** Workers から Node 上の Playwright sidecar（FUDO_BROWSER_ACT_URL）を叩く。 */
export function createHttpBrowserSession(
  baseUrl: string,
  options: HttpBrowserSessionOptions = {}
): BrowserSession {
  const root = baseUrl.replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const token = options.token?.trim() ?? "";
  let cachedLiveView: string | null = null;

  async function post<T>(path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetchImpl(`${root}${path}`, {
      method: "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
    if (!res.ok) {
      throw new Error(typeof data.error === "string" ? data.error : `browser_act_http_${res.status}`);
    }
    return data;
  }

  async function hydrateLiveView(): Promise<void> {
    try {
      const data = await post<{ url?: string | null }>("/live-view");
      cachedLiveView = typeof data.url === "string" && data.url.trim() ? data.url.trim() : null;
    } catch {
      cachedLiveView = null;
    }
  }

  return {
    async navigate(url) {
      const result = await post<BrowserSessionSnapshot>("/navigate", { url });
      await hydrateLiveView();
      return result;
    },
    snapshot: () => post<BrowserSessionSnapshot>("/snapshot"),
    click: (target: BrowserClickTarget) => post<{ url: string; title: string }>("/click", target),
    type: (selector, text, submit) =>
      post<{ url: string; title: string }>("/type", { selector, text, submit: submit === true }),
    scroll: (target: BrowserScrollTarget) => post<{ url: string; title: string }>("/scroll", target),
    select: (target: BrowserSelectTarget) => post<{ url: string; title: string }>("/select", target),
    async insertText(text) {
      await post<{ ok: true }>("/insert-text", { text });
    },
    async screenshot() {
      try {
        const data = await post<Partial<BrowserScreenshot>>("/screenshot");
        if (data.mime === "image/jpeg" && typeof data.base64 === "string" && data.base64) {
          return { mime: "image/jpeg", base64: data.base64 };
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
      await post<{ detached: true }>("/detach");
    },
    close: async () => {
      cachedLiveView = null;
      await post<{ closed: true }>("/close");
    }
  };
}

export function browserActUrlFromEnv(
  env: Readonly<Record<string, string | undefined>> = {}
): string | undefined {
  const raw = env["FUDO_BROWSER_ACT_URL"]?.trim();
  return raw || undefined;
}

export function browserActTokenFromEnv(
  env: Readonly<Record<string, string | undefined>> = {}
): string | undefined {
  const raw = env["FUDO_BROWSER_ACT_TOKEN"]?.trim();
  return raw || undefined;
}
