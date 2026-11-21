import { bindings, defineConfig, defineContainer, exports } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

// Cursor 親環境の試験用 FUDO_DAILY_TOKEN_CAP=1000 がローカル API を常時塞ぐのを防ぐ（web/local/dev.ts と同趣旨）。
// 上限を掛けたいときは packages/api/.dev.vars に明示する。
if (process.env.FUDO_DAILY_TOKEN_CAP === "1000") {
  delete process.env.FUDO_DAILY_TOKEN_CAP;
}

/** ローカルで Docker が無いときは 0。本番／browser-act・CLI 実機は 1。 */
const containersOn = process.env.FUDO_ENABLE_CONTAINERS === "1";
/** 本番 browser-act（Steel）。containersOn かつ STEEL_API_KEY があるとき。 */
const browserActOn =
  containersOn && Boolean(process.env.STEEL_API_KEY?.trim()) && process.env.FUDO_BROWSER_ACT !== "0";

/**
 * 資格情報は既定で bindings.secret()（デプロイ成果物に平文を載せない）。
 * 移行中のみ FUDO_PLAINTEXT_SECRETS=1 で text に戻せる。
 */
const plaintextSecrets = process.env.FUDO_PLAINTEXT_SECRETS === "1";
function credential(name: string) {
  if (plaintextSecrets || !process.env[name]?.trim()) return bindings.text(process.env[name] ?? "");
  return bindings.secret();
}

const userSandbox = defineContainer({
  name: "fudo-user-sandbox",
  schedulingPolicy: "durable-object",
  images: {
    debian: { dockerfile: "./Dockerfile.sandbox" }
  }
});

const browserAct = defineContainer({
  name: "fudo-browser-act",
  schedulingPolicy: "durable-object",
  images: {
    "browser-act": { dockerfile: "./Dockerfile.browser-act" }
  }
});

export default defineConfig({
  ...(containersOn
    ? { containers: browserActOn ? [userSandbox, browserAct] : [userSandbox] }
    : {}),
  worker: {
    name: "fudo-api",
    compatibilityDate: "2026-10-01",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint,
    // 画面も Worker を先に通す。Access の JWT を検証してから ASSETS を返す。
    assets: { notFoundHandling: "single-page-application", runWorkerFirst: true },
    exports: {
      SessionDO: exports.durableObject({ storage: "sqlite" }),
      AnthropicEgress: exports.worker(),
      UserSandbox: containersOn
        ? exports.durableObject({ storage: "sqlite", container: userSandbox })
        : exports.durableObject({ storage: "sqlite" }),
      ...(browserActOn
        ? {
            BrowserAct: exports.durableObject({ storage: "sqlite", container: browserAct })
          }
        : {
            BrowserAct: exports.durableObject({ storage: "sqlite" })
          })
    },
    env: {
      ASSETS: bindings.assets(),
      // 対話・検索の唯一の経路。ローカルでも本物を呼び、ログイン中のアカウントに課金される。
      AI: bindings.ai({ dev: { remote: true } }),
      SESSION: bindings.durableObject({
        worker: "fudo-api",
        exportName: "SessionDO"
      }),
      USER_SANDBOX: bindings.durableObject({
        worker: "fudo-api",
        exportName: "UserSandbox"
      }),
      BROWSER_ACT: bindings.durableObject({
        worker: "fudo-api",
        exportName: "BrowserAct"
      }),
      DB: bindings.d1({ name: "fudo-ledger" }),
      DOCS: bindings.r2({ name: "fudo-docs" }),
      FUDO_CONTAINERS: bindings.text(containersOn ? "1" : ""),
      // run_agent 用。サンドボックスへは渡さず、AnthropicEgress だけが読む。
      // 宣言した Secret は本番に置かないと配備できないので、コンテナを使うときだけ宣言する。
      ...(containersOn
        ? {
            ANTHROPIC_API_KEY: credential("ANTHROPIC_API_KEY"),
            GITHUB_APP_PRIVATE_KEY: credential("GITHUB_APP_PRIVATE_KEY")
          }
        : {}),
      FUDO_AGENT_MAX_USD: bindings.text(process.env.FUDO_AGENT_MAX_USD ?? ""),
      FUDO_AGENT_REPOS: bindings.text(process.env.FUDO_AGENT_REPOS ?? ""),
      GITHUB_APP_ID: bindings.text(process.env.GITHUB_APP_ID ?? ""),
      GITHUB_APP_INSTALLATION_ID: bindings.text(process.env.GITHUB_APP_INSTALLATION_ID ?? ""),
      AGENT_CHAT_MODEL: bindings.text(process.env.AGENT_CHAT_MODEL ?? ""),
      CF_ACCESS_TEAM_DOMAIN: bindings.text(process.env.CF_ACCESS_TEAM_DOMAIN ?? ""),
      CF_ACCESS_AUD: bindings.text(process.env.CF_ACCESS_AUD ?? ""),
      FUDO_OWNER_EMAIL: bindings.text(process.env.FUDO_OWNER_EMAIL ?? ""),
      FUDO_DAILY_TOKEN_CAP: bindings.text(process.env.FUDO_DAILY_TOKEN_CAP ?? ""),
      FUDO_BUILD_ID: bindings.text(process.env.FUDO_BUILD_ID ?? ""),
      FUDO_MCP_HOST_ALLOW: bindings.text(process.env.FUDO_MCP_HOST_ALLOW ?? ""),
      FUDO_BROWSER_HOST_ALLOW: bindings.text(process.env.FUDO_BROWSER_HOST_ALLOW ?? ""),
      FUDO_ALLOWED_ORIGINS: bindings.text(process.env.FUDO_ALLOWED_ORIGINS ?? ""),
      // 一般本線は Browser Run（cf）。steel は明示 or binding 無しの退避。
      FUDO_BROWSER_BACKEND: bindings.text(process.env.FUDO_BROWSER_BACKEND ?? "auto"),
      FUDO_BROWSER_ACT_URL: bindings.text(process.env.FUDO_BROWSER_ACT_URL ?? ""),
      /** CF 429 時の Steel sidecar（ローカル）。本番 Container 退避とは別。 */
      FUDO_BROWSER_STEEL_FALLBACK_URL: bindings.text(
        process.env.FUDO_BROWSER_STEEL_FALLBACK_URL ?? ""
      ),
      FUDO_BROWSER_ACT_TOKEN: credential("FUDO_BROWSER_ACT_TOKEN"),
      // ローカルも本物の Browser Run（Live View 用）。模擬にするときだけ FUDO_BROWSER_REMOTE=0。
      BROWSER: bindings.browser({
        dev: {
          remote: process.env.FUDO_BROWSER_REMOTE !== "0" && process.env.FUDO_BROWSER_REMOTE !== "false"
        }
      }),

      STEEL_API_KEY: credential("STEEL_API_KEY"),
      STEEL_BASE_URL: bindings.text(process.env.STEEL_BASE_URL ?? ""),
      STEEL_USE_PROXY: bindings.text(process.env.STEEL_USE_PROXY ?? ""),
      STEEL_PROXY_COUNTRY: bindings.text(process.env.STEEL_PROXY_COUNTRY ?? ""),
      ...(browserActOn ? { STEEL_PROXY_URL: credential("STEEL_PROXY_URL") } : {}),
      FUDO_CLI_ALLOW: bindings.text(process.env.FUDO_CLI_ALLOW ?? ""),
      FUDO_AGENT_ALLOW: bindings.text(process.env.FUDO_AGENT_ALLOW ?? ""),
      FUDO_MCP_SECRET_KEY: credential("FUDO_MCP_SECRET_KEY"),
      FUDO_MCP_OAUTH_CLIENT_GITHUB: bindings.text(process.env.FUDO_MCP_OAUTH_CLIENT_GITHUB ?? ""),
      FUDO_MCP_OAUTH_SECRET_GITHUB: credential("FUDO_MCP_OAUTH_SECRET_GITHUB"),
      FUDO_MCP_OAUTH_CLIENT_SLACK: bindings.text(process.env.FUDO_MCP_OAUTH_CLIENT_SLACK ?? ""),
      FUDO_MCP_OAUTH_SECRET_SLACK: credential("FUDO_MCP_OAUTH_SECRET_SLACK"),
      FUDO_MCP_OAUTH_CLIENT_FIGMA: bindings.text(process.env.FUDO_MCP_OAUTH_CLIENT_FIGMA ?? ""),
      FUDO_MCP_OAUTH_SECRET_FIGMA: credential("FUDO_MCP_OAUTH_SECRET_FIGMA")
    }
  }
});
