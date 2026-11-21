/** ブラウザ閲覧（B1: URL → Markdown）。操作・ログインは後段。 */

import { detectContentWall } from "./contentWall";
import { detectUnusableFetch } from "./fetchUsable";
import {
  BROWSER_FETCH_PER_TURN as FETCH_LIMIT,
  BROWSER_RENDER_PER_TURN as RENDER_LIMIT
} from "./limits";

export { BROWSER_FETCH_PER_TURN, BROWSER_RENDER_PER_TURN } from "./limits";
export const BROWSER_MARKDOWN_CHARS = 12_000;

export type BrowserFetchResult = {
  url: string;
  finalUrl?: string;
  title?: string;
  markdown: string;
  truncated: boolean;
};

export type BrowserFetchAdapter = (url: string) => Promise<BrowserFetchResult>;

export type BrowserFetchOutcome =
  | { ok: true; result: BrowserFetchResult }
  | {
      ok: false;
      reason:
        | "limit"
        | "invalid_url"
        | "host_denied"
        | "private_host"
        | "unavailable"
        | "provider_auth"
        | "content_wall"
        | "unusable_content"
        | "http_error";
      detail?: { constraint?: string; status?: number };
    };

/** DNS でループバックに落ちる既知ホスト（解決前の字面拒否）。 */
const LOOPBACK_DNS_NAMES = new Set([
  "localhost",
  "localtest.me",
  "localhost.localdomain",
  "vcap.me",
  "lvh.me",
  "127.0.0.1.nip.io",
  "0.0.0.0"
]);

export function parseBrowserHostAllow(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,\s]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

export function browserHostAllowFromEnv(
  env: Readonly<Record<string, string | undefined>> = {}
): string[] {
  return parseBrowserHostAllow(env["FUDO_BROWSER_HOST_ALLOW"]);
}

/** IPv4 / IPv4-mapped IPv6 / ULA / link-local / ループバック別名をプライベート扱い。 */
export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (LOOPBACK_DNS_NAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".localtest.me")) {
    return true;
  }
  if (host.includes("metadata.google") || host.startsWith("metadata.")) return true;

  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) {
    return isPrivateIpv4(bare);
  }

  // IPv6（圧縮・IPv4-mapped 含む）
  if (bare.includes(":")) {
    return isPrivateIpv6(bare);
  }

  return false;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const a = parts[0]!;
  const b = parts[1]!;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateIpv6(raw: string): boolean {
  const lower = raw.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  // IPv4-mapped ::ffff:127.0.0.1 / ::ffff:7f00:1
  const ffff = lower.indexOf("ffff:");
  if (ffff >= 0) {
    const after = lower.slice(ffff + "ffff:".length);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(after)) return isPrivateIpv4(after);
    const hex = after.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = Number.parseInt(hex[1]!, 16);
      const lo = Number.parseInt(hex[2]!, 16);
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        return isPrivateIpv4(
          `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
        );
      }
    }
  }
  // Unique local fc00::/7, link-local fe80::/10
  const head = lower.replace(/^:+/, "").slice(0, 4);
  if (/^f[cd]/i.test(head) || /^fe[89ab]/i.test(head)) return true;
  return false;
}

/** 許可リストが空なら公開 https を広く許し、プライベート網だけ拒む。 */
export function isBrowserHostAllowed(hostname: string, allowHosts: readonly string[]): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return false;
  if (isPrivateHostname(host)) return false;
  if (allowHosts.length === 0) return true;
  return allowHosts.some((rule) => host === rule || host.endsWith(`.${rule}`));
}

export function assertBrowserUrl(
  raw: string,
  allowHosts: readonly string[] = []
): { ok: true; url: URL } | { ok: false; reason: "invalid_url" | "host_denied" | "private_host" } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "invalid_url" };
  if (isPrivateHostname(url.hostname)) return { ok: false, reason: "private_host" };
  if (!isBrowserHostAllowed(url.hostname, allowHosts)) return { ok: false, reason: "host_denied" };
  return { ok: true, url };
}

export function truncateMarkdown(markdown: string, max = BROWSER_MARKDOWN_CHARS): {
  text: string;
  truncated: boolean;
} {
  if (markdown.length <= max) return { text: markdown, truncated: false };
  return { text: markdown.slice(0, max), truncated: true };
}

export type BrowserFetchLadderOptions = {
  /** 静的失敗（壁・使えぬ本文）時の動的レンダリング。 */
  rendered?: BrowserFetchAdapter;
  rendersSoFar?: number;
  renderMax?: number;
  /** レンダ試行を消費したとき（成否問わず）。 */
  onRenderedAttempt?: () => void;
};

function outcomeFromMarkdown(
  result: BrowserFetchResult,
  requestedUrl: string,
  allowHosts: readonly string[]
): BrowserFetchOutcome {
  const effective = result.finalUrl?.trim() || result.url?.trim() || requestedUrl;
  const finalCheck = assertBrowserUrl(effective, allowHosts);
  if (!finalCheck.ok) {
    return {
      ok: false,
      reason: finalCheck.reason,
      detail: { constraint: `redirect_denied:${effective.slice(0, 200)}` }
    };
  }
  const cut = truncateMarkdown(result.markdown);
  if (detectContentWall(cut.text)) {
    return {
      ok: false,
      reason: "content_wall",
      detail: {
        constraint:
          "有料・ログイン壁の可能性。すり抜け・回避はしない。次の公開候補 URL を browser_fetch する。"
      }
    };
  }
  if (detectUnusableFetch(cut.text)) {
    return {
      ok: false,
      reason: "unusable_content",
      detail: {
        constraint:
          "本文が空またはエラーページ相当で根拠に使えない。すり抜けしない。未精読の別ホスト URL を browser_fetch する。"
      }
    };
  }
  return {
    ok: true,
    result: {
      ...result,
      url: requestedUrl,
      finalUrl: finalCheck.url.toString(),
      markdown: cut.text,
      truncated: result.truncated || cut.truncated
    }
  };
}

export async function browserFetch(
  callsSoFar: number,
  rawUrl: string,
  adapter: BrowserFetchAdapter | undefined,
  allowHosts: readonly string[] = [],
  ladder: BrowserFetchLadderOptions = {}
): Promise<BrowserFetchOutcome> {
  if (callsSoFar >= FETCH_LIMIT) return { ok: false, reason: "limit" };
  const checked = assertBrowserUrl(rawUrl, allowHosts);
  if (!checked.ok) return { ok: false, reason: checked.reason };
  if (!adapter) {
    return {
      ok: false,
      reason: "unavailable",
      detail: { constraint: "Browser Run の資格情報が無い" }
    };
  }

  const requested = checked.url.toString();
  let staticOutcome: BrowserFetchOutcome;
  try {
    const result = await adapter(requested);
    staticOutcome = outcomeFromMarkdown(result, requested, allowHosts);
  } catch (error) {
    staticOutcome = mapFetchError(error);
  }

  const softFail =
    !staticOutcome.ok &&
    (staticOutcome.reason === "content_wall" || staticOutcome.reason === "unusable_content");
  if (!softFail) return staticOutcome;

  const renderMax = ladder.renderMax ?? RENDER_LIMIT;
  const rendersSoFar = ladder.rendersSoFar ?? 0;
  if (!ladder.rendered || rendersSoFar >= renderMax) return staticOutcome;

  ladder.onRenderedAttempt?.();
  try {
    const rendered = await ladder.rendered(requested);
    const renderedOutcome = outcomeFromMarkdown(rendered, requested, allowHosts);
    if (renderedOutcome.ok) return renderedOutcome;
    return renderedOutcome.ok === false ? renderedOutcome : staticOutcome;
  } catch {
    return staticOutcome;
  }
}

function mapFetchError(error: unknown): BrowserFetchOutcome {
  const status =
    error && typeof error === "object" && "status" in error && typeof error.status === "number"
      ? error.status
      : undefined;
  const message = error instanceof Error ? error.message.slice(0, 200) : "browser_fetch_failed";
  if (status === 401 || status === 403 || /authentication|authorization|permission/i.test(message)) {
    return {
      ok: false,
      reason: "provider_auth",
      detail: {
        constraint:
          "読み取り先の認証に失敗した。JINA_API_KEY を確認する",
        ...(status !== undefined ? { status } : {})
      }
    };
  }
  return {
    ok: false,
    reason: status && status >= 400 ? "http_error" : "unavailable",
    detail: {
      constraint: message,
      ...(status !== undefined ? { status } : {})
    }
  };
}
