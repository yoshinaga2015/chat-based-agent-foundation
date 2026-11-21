/**
 * ローカル Playwright sidecar（127.0.0.1 のみ）。
 * Workers の speak から FUDO_BROWSER_ACT_URL 経由で呼ばれる。
 */
import { createServer } from "node:http";
import { createLocalBrowserSession } from "../src/browserLocal.ts";
import { browserBackendFromEnv } from "../src/browserSession.ts";
import type { BrowserSession } from "../src/browserSession.ts";
import { createSteelBrowserSession } from "../src/browserSteel.ts";
import { assertSteelPlayerUrl, patchSteelPlayerHtml } from "../src/browserSteelPlayer.ts";
// Playwright はここ（Node）だけ。Workers バンドルには入れない。

const port = Number(process.env.FUDO_BROWSER_ACT_PORT ?? "4176");
const host = process.env.FUDO_BROWSER_ACT_HOST?.trim() || "127.0.0.1";

let session: BrowserSession | null = null;

function ensure(): BrowserSession {
  if (!session) {
    const backend = browserBackendFromEnv(process.env);
    session =
      backend === "steel" ? createSteelBrowserSession(process.env) : createLocalBrowserSession(process.env);
  }
  return session;
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  if (req.method === "GET" && (req.url === "/live-player" || req.url?.startsWith("/live-player?"))) {
    try {
      const src = new URL(req.url, "http://localhost").searchParams.get("src") || "";
      const target = assertSteelPlayerUrl(src);
      const upstream = await fetch(target, {
        headers: { "user-agent": "fudo-browser-act/1.0", accept: "text/html" }
      });
      if (!upstream.ok) {
        res.writeHead(upstream.status, { "content-type": "text/plain; charset=utf-8" });
        res.end(`steel_player_fetch_${upstream.status}`);
        return;
      }
      const html = patchSteelPlayerHtml(await upstream.text());
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store"
      });
      res.end(html);
    } catch (error) {
      const message = error instanceof Error ? error.message : "live_player_failed";
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end(message.slice(0, 200));
    }
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }
  try {
    const body = await readJson(req);
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/navigate") {
      const url = typeof body.url === "string" ? body.url : "";
      json(res, 200, await ensure().navigate(url));
      return;
    }
    if (path === "/snapshot") {
      json(res, 200, await ensure().snapshot());
      return;
    }
    if (path === "/click") {
      json(
        res,
        200,
        await ensure().click({
          name: typeof body.name === "string" ? body.name : undefined,
          role: typeof body.role === "string" ? body.role : undefined,
          selector: typeof body.selector === "string" ? body.selector : undefined
        })
      );
      return;
    }
    if (path === "/type") {
      const selector = typeof body.selector === "string" ? body.selector : "";
      const text = typeof body.text === "string" ? body.text : "";
      json(res, 200, await ensure().type(selector, text, body.submit === true));
      return;
    }
    if (path === "/scroll") {
      const direction = body.direction === "up" || body.direction === "down" ? body.direction : null;
      if (!direction) {
        json(res, 400, { error: "direction required" });
        return;
      }
      json(
        res,
        200,
        await ensure().scroll({
          direction,
          amount: typeof body.amount === "number" ? body.amount : undefined,
          selector: typeof body.selector === "string" ? body.selector : undefined
        })
      );
      return;
    }
    if (path === "/select") {
      const selector = typeof body.selector === "string" ? body.selector : "";
      json(
        res,
        200,
        await ensure().select({
          selector,
          value: typeof body.value === "string" ? body.value : undefined,
          label: typeof body.label === "string" ? body.label : undefined
        })
      );
      return;
    }
    if (path === "/insert-text") {
      const value = typeof body.text === "string" ? body.text : "";
      if (!value) {
        json(res, 400, { error: "empty" });
        return;
      }
      if (value.length > 2000) {
        json(res, 400, { error: "too_long" });
        return;
      }
      await ensure().insertText(value);
      await ensure().detachForHandoff();
      json(res, 200, { ok: true });
      return;
    }
    if (path === "/screenshot") {
      const shot = await ensure().screenshot();
      json(res, 200, shot ?? { mime: null, base64: null });
      return;
    }
    if (path === "/live-view") {
      json(res, 200, { url: ensure().liveViewUrl() });
      return;
    }
    if (path === "/detach") {
      if (session) await session.detachForHandoff();
      json(res, 200, { detached: true });
      return;
    }
    if (path === "/close") {
      if (session) {
        await session.close();
        session = null;
      }
      json(res, 200, { closed: true });
      return;
    }
    res.writeHead(404).end();
  } catch (error) {
    json(res, 500, {
      error: error instanceof Error ? error.message.slice(0, 300) : "browser_act_failed"
    });
  }
});

server.listen(port, host, () => {
  console.log(`browser-act http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void (async () => {
      if (session) await session.close().catch(() => undefined);
      server.close(() => process.exit(0));
    })();
  });
}

function json(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readJson(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 64_000) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}
