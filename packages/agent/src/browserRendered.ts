/**
 * 静的取得失敗時の動的レンダリング精読（Rendered Read）。
 * 一時 BrowserSession で navigate → 本文。操作・すり抜けなし。
 * Workers は FUDO_BROWSER_ACT_URL（sidecar）経由。Playwright 直は Node のみ。
 */

import {
  browserActTokenFromEnv,
  browserActUrlFromEnv,
  createHttpBrowserSession
} from "./browserActHttp";
import type { BrowserFetchAdapter, BrowserFetchResult } from "./browser";
import { truncateMarkdown } from "./browser";
import { browserBackendFromEnv, type BrowserSession } from "./browserSession";

export function productRenderedRead(
  env: Readonly<Record<string, string | undefined>> = {}
): BrowserFetchAdapter | undefined {
  if (browserBackendFromEnv(env) === "off") return undefined;
  const actUrl = browserActUrlFromEnv(env);
  // Workers に Playwright を引き込まない。ローカル精読は明示オプトイン。
  const allowLocal = /^(1|true|yes|local)$/i.test(env["FUDO_BROWSER_RENDER"]?.trim() ?? "");
  if (!actUrl && !allowLocal) return undefined;

  return async (url) => {
    const session = await openEphemeralSession(env, actUrl);
    if (!session) throw new Error("rendered_read_unavailable");
    try {
      const snap = await session.navigate(url);
      const markdownRaw = (snap.text ?? "").trim();
      if (!markdownRaw) throw new Error("rendered_read_empty");
      const cut = truncateMarkdown(markdownRaw);
      return {
        url,
        finalUrl: snap.url || url,
        title: snap.title,
        markdown: cut.text,
        truncated: snap.truncated || cut.truncated
      } satisfies BrowserFetchResult;
    } finally {
      await session.close().catch(() => undefined);
    }
  };
}

async function openEphemeralSession(
  env: Readonly<Record<string, string | undefined>>,
  actUrl: string | undefined
): Promise<BrowserSession | undefined> {
  if (actUrl) {
    return createHttpBrowserSession(actUrl, { token: browserActTokenFromEnv(env) });
  }
  // Node／sidecar 専用。Workers バンドルに Playwright を引き込まない。
  try {
    const { createLocalBrowserSession } = await import("./browserLocal");
    return createLocalBrowserSession(env);
  } catch {
    return undefined;
  }
}
