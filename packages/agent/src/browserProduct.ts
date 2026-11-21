import {
  browserActTokenFromEnv,
  browserActUrlFromEnv,
  createHttpBrowserSession
} from "./browserActHttp";
import type { BrowserSession } from "./browserSession";
import { browserBackendFromEnv } from "./browserSession";

/**
 * Workers 安全な製品セッション生成。
 * Playwright／Steel CDP はここに載せない（Container / sidecar 側）。
 */
export function productBrowserSession(
  env: Readonly<Record<string, string | undefined>> = process.env
): BrowserSession | undefined {
  if (browserBackendFromEnv(env) === "off") return undefined;
  const actUrl = browserActUrlFromEnv(env);
  if (actUrl) {
    return createHttpBrowserSession(actUrl, { token: browserActTokenFromEnv(env) });
  }
  return undefined;
}
