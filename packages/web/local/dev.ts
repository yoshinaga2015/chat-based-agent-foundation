import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "vite";

// 親シェルに残った試験用 FUDO_DAILY_TOKEN_CAP=1000 などを捨て、プロジェクト env を優先する。
delete process.env.FUDO_DAILY_TOKEN_CAP;
// 空文字のシェル export は「未設定」扱い（FUDO_BROWSER_ACT_URL= がルート .env を潰すのを防ぐ）。
loadEnvFile(resolve(process.cwd(), ".env"));
loadEnvFile(resolve(process.cwd(), "../../.env"));
// api の .dev.vars（AI トークン・Slack OAuth 等）。ルート .env のデプロイ用トークンを上書きする。
loadEnvFile(resolve(process.cwd(), "../api/.dev.vars"), true);

// browser-act sidecar（local Chromium または Steel CDP）。Workers は HTTP 経由。
// cf（Browser Run）は Workers の BROWSER binding 本線。429 時は Steel sidecar へ退避。
const browserBackend = (process.env.FUDO_BROWSER_BACKEND ?? "local").trim().toLowerCase();
const browserCf =
  browserBackend === "cf" || browserBackend === "browser-run" || browserBackend === "browserrun";
const steelKey = process.env.STEEL_API_KEY?.trim() ?? "";
if (browserCf) {
  process.env.FUDO_BROWSER_BACKEND = "cf";
  delete process.env.FUDO_BROWSER_ACT_URL;
  // Browser binding remote は限られた API トークンより wrangler OAuth が必要。
  // .dev.vars の CLOUDFLARE_API_TOKEN が勝つと Live View 用 remote が落ちる。
  const remoteOff =
    process.env.FUDO_BROWSER_REMOTE === "0" || process.env.FUDO_BROWSER_REMOTE === "false";
  if (!remoteOff) {
    delete process.env.CLOUDFLARE_API_TOKEN;
  }
  if (steelKey) {
    process.env.FUDO_BROWSER_STEEL_FALLBACK_URL =
      process.env.FUDO_BROWSER_STEEL_FALLBACK_URL?.trim() || "http://127.0.0.1:4176";
  }
}
const browserActOn =
  !browserCf &&
  (browserBackend === "local" ||
    browserBackend === "steel" ||
    browserBackend === "" ||
    browserBackend === "auto");
const steelFallbackSidecar = browserCf && Boolean(steelKey);
if (browserActOn) {
  process.env.FUDO_BROWSER_BACKEND =
    process.env.FUDO_BROWSER_BACKEND?.trim() || (steelKey ? "steel" : "local");
  process.env.FUDO_BROWSER_ACT_URL =
    process.env.FUDO_BROWSER_ACT_URL?.trim() || "http://127.0.0.1:4176";
}

let api: ChildProcess | null = null;
let browserAct: ChildProcess | null = null;

if (browserActOn || steelFallbackSidecar) {
  const actUrl = (
    browserActOn
      ? process.env.FUDO_BROWSER_ACT_URL
      : process.env.FUDO_BROWSER_STEEL_FALLBACK_URL
  )?.replace(/\/$/, "") || "http://127.0.0.1:4176";
  const localAct = isLocalActUrl(actUrl);
  let actHealthy = await probe(`${actUrl}/health`);
  let routesOk = actHealthy ? await probeActRoutes(actUrl) : false;
  if (localAct && actHealthy && !routesOk) {
    console.warn(
      `[fudo] ${actUrl} に /screenshot または /scroll が無い（古い sidecar）。差し替えます。`
    );
    await freeLocalActPort(actUrl);
    actHealthy = false;
    routesOk = false;
  }
  if (!actHealthy) {
    if (!localAct) {
      throw new Error(`browser-act が応答しない: ${actUrl}/health`);
    }
    const sidecarEnv = {
      ...process.env,
      ...(steelFallbackSidecar
        ? {
            FUDO_BROWSER_BACKEND: "steel",
            FUDO_BROWSER_ACT_URL: actUrl
          }
        : {})
    };
    browserAct = spawn("pnpm", ["--filter", "agent", "browser-act"], {
      cwd: resolve(process.cwd(), "../.."),
      stdio: "inherit",
      env: sidecarEnv
    });
    await waitForApi(`${actUrl}/health`, 60_000);
    if (!(await probeActRoutes(actUrl))) {
      throw new Error(`browser-act に /screenshot または /scroll が無い: ${actUrl}`);
    }
  }
}

const apiHealthy = await probe("http://127.0.0.1:4175/health");
if (!apiHealthy) {
  api = spawn("pnpm", ["--filter", "api", "dev"], {
    cwd: resolve(process.cwd(), "../.."),
    stdio: "inherit",
    env: process.env
  });
  await waitForApi("http://127.0.0.1:4175/health", 60_000);
}

const migratePath = resolve(process.cwd(), ".fudo", "session.json");
if (existsSync(migratePath)) {
  try {
    const blob = JSON.parse(readFileSync(migratePath, "utf8"));
    await fetch("http://127.0.0.1:4175/api/migrate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Origin: "http://127.0.0.1:4174"
      },
      body: JSON.stringify(blob)
    });
  } catch {
    // 移行失敗でも UI は起動する
  }
}

const vite = await createServer();
await vite.listen();
vite.printUrls();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    api?.kill("SIGTERM");
    browserAct?.kill("SIGTERM");
    void vite.close().then(() => process.exit(0));
  });
}

/** 後から読んだファイルが勝つ（api/.dev.vars で AI 用トークンを上書きするため）。 */
function loadEnvFile(path: string, override = false): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const key = match[1];
    if (!key) continue;
    const current = process.env[key];
    // 空文字のシェル export は未設定扱い（例: FUDO_BROWSER_ACT_URL= が Fly URL を潰す）。
    if (!override && current !== undefined && current !== "") continue;
    let value = match[2] ?? "";
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function isLocalActUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

async function probe(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

/** エンドポイント有無だけ見る（セッション無しの 4xx/5xx は可。404 は古い sidecar）。 */
async function probeActRoute(actUrl: string, path: string): Promise<boolean> {
  try {
    const res = await fetch(`${actUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    return res.status !== 404;
  } catch {
    return false;
  }
}

async function probeActRoutes(actUrl: string): Promise<boolean> {
  const shot = await probeActRoute(actUrl, "/screenshot");
  const scroll = await probeActRoute(actUrl, "/scroll");
  return shot && scroll;
}

async function freeLocalActPort(actUrl: string): Promise<void> {
  let port = 4176;
  try {
    port = Number(new URL(actUrl).port || "4176");
  } catch {
    // keep default
  }
  await new Promise<void>((resolveDone) => {
    const killer = spawn(
      "sh",
      ["-c", `lsof -tiTCP:${port} -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null; true`],
      { stdio: "ignore" }
    );
    killer.on("exit", () => resolveDone());
    killer.on("error", () => resolveDone());
  });
  await new Promise((r) => setTimeout(r, 400));
}

async function waitForApi(url: string, ms: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await probe(url)) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`api not ready: ${url}`);
}
