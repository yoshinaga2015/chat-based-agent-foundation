/**
 * 本番 Container 用 browser-act（Steel CDP）。
 * packages/agent のロジックと同型。依存は playwright のみ。
 */
import { createServer } from "node:http";
import { chromium } from "playwright";

const port = Number(process.env.FUDO_BROWSER_ACT_PORT ?? "4176");
const host = process.env.FUDO_BROWSER_ACT_HOST?.trim() || "0.0.0.0";
const apiKey = process.env.STEEL_API_KEY?.trim() ?? "";
const actToken = process.env.FUDO_BROWSER_ACT_TOKEN?.trim() ?? "";
const base = (process.env.STEEL_BASE_URL?.trim() || "https://api.steel.dev").replace(/\/$/, "");

if (!actToken) {
  console.error("FUDO_BROWSER_ACT_TOKEN が必須（空トークンでの公開は禁止）");
  process.exit(1);
}

let browser = null;
let page = null;
let steelId = null;
let viewerUrl = null;
let websocketUrl = null;
let closed = false;

async function connectPage(sessionId, wsHint) {
  const ws =
    (typeof wsHint === "string" && wsHint.trim()) ||
    `wss://connect.steel.dev?sessionId=${encodeURIComponent(sessionId)}`;
  const sep = ws.includes("?") ? "&" : "?";
  browser = await chromium.connectOverCDP(`${ws}${sep}apiKey=${encodeURIComponent(apiKey)}`);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(15_000);
  return page;
}

async function ensurePage() {
  if (closed) throw new Error("browser_session_closed");
  if (page) return page;
  if (!apiKey) throw new Error("STEEL_API_KEY が無い");
  if (steelId) {
    try {
      return await connectPage(steelId, websocketUrl);
    } catch {
      // タイムアウト／手動 release 後は死んだ id のまま落ちる。捨てて新規。
      const b = browser;
      browser = null;
      page = null;
      steelId = null;
      websocketUrl = null;
      viewerUrl = null;
      if (b) await b.close().catch(() => undefined);
    }
  }
  const created = await createRemoteSession();
  steelId = created.id;
  websocketUrl = typeof created.websocketUrl === "string" ? created.websocketUrl.trim() : null;
  // sessionViewerUrl は app.steel.dev（要ログイン）。handoff は認証不要の debugUrl。
  // 公開ラップは /live-view で Host 付きにする（ここでは Steel 直 URL を保持）。
  viewerUrl = steelInteractiveDebugUrl(created);
  return connectPage(steelId, websocketUrl);
}

async function detachForHandoff() {
  const b = browser;
  browser = null;
  page = null;
  if (b) await b.close().catch(() => undefined);
}

/** insert-text 専用。死んだ id でも新規セッションは作らない。 */
async function reconnectExisting() {
  if (closed) throw new Error("browser_session_closed");
  if (!steelId) throw new Error("browser_session_not_open");
  if (page) {
    try {
      await page.evaluate(() => true);
      return page;
    } catch {
      const b = browser;
      browser = null;
      page = null;
      if (b) await b.close().catch(() => undefined);
    }
  }
  try {
    const current = await connectPage(steelId, websocketUrl);
    await current.evaluate(() => true);
    return current;
  } catch {
    const b = browser;
    browser = null;
    page = null;
    if (b) await b.close().catch(() => undefined);
    throw new Error("browser_session_stale");
  }
}

/**
 * Live View → fudo へフォーカス移動で activeElement が外れるため、
 * フォーカス欄 → 検索っぽい欄 → 先頭の可視 input へネイティブ挿入。
 */
async function insertTextIntoPage(current, value) {
  for (const frame of current.frames()) {
    const ok = await frame
      .evaluate((chunk) => {
        function isEditable(el) {
          if (!el || el.nodeType !== 1) return false;
          if (el.isContentEditable) return true;
          if (el.getAttribute("role") === "textbox") return true;
          const tag = el.tagName;
          if (tag === "TEXTAREA") return !el.disabled && !el.readOnly;
          if (tag === "INPUT") {
            const type = (el.type || "text").toLowerCase();
            if (el.disabled || el.readOnly) return false;
            return ![
              "button",
              "submit",
              "checkbox",
              "radio",
              "file",
              "hidden",
              "image",
              "reset",
              "range",
              "color"
            ].includes(type);
          }
          return false;
        }
        function setNative(el, next) {
          const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const desc = Object.getOwnPropertyDescriptor(proto, "value");
          if (desc && desc.set) desc.set.call(el, next);
          else el.value = next;
        }
        function write(el, data) {
          el.focus();
          if (el.isContentEditable || el.getAttribute("role") === "textbox") {
            return document.execCommand("insertText", false, data);
          }
          const start = el.selectionStart ?? el.value.length;
          const end = el.selectionEnd ?? el.value.length;
          const next = el.value.slice(0, start) + data + el.value.slice(end);
          setNative(el, next);
          el.dispatchEvent(
            new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data })
          );
          el.dispatchEvent(new Event("change", { bubbles: true }));
          try {
            el.setSelectionRange(start + data.length, start + data.length);
          } catch {
            // number 等
          }
          return true;
        }
        const active = document.activeElement;
        if (isEditable(active)) return write(active, chunk);
        const nodes = [...document.querySelectorAll("input, textarea, [contenteditable='true']")];
        const visible = nodes.filter((node) => {
          if (!isEditable(node)) return false;
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        const scored = visible.map((node) => {
          const hint = `${node.name || ""} ${node.id} ${node.placeholder || ""} ${node.getAttribute("aria-label") || ""}`;
          const searchLike = /search|検索|keyword|住所|address|\bq\b|query|地名/i.test(hint) ? 2 : 0;
          const empty = "value" in node && String(node.value || "").length === 0 ? 1 : 0;
          return { el: node, score: searchLike + empty };
        });
        scored.sort((a, b) => b.score - a.score);
        const pick = scored[0] && scored[0].el;
        if (!pick) return false;
        return write(pick, chunk);
      }, value)
      .catch(() => false);
    if (ok) return;
  }
  await current.keyboard.insertText(value);
}

async function screenshotOf(current) {
  const max = 40_000;
  for (const quality of [48, 36, 28, 20]) {
    const buf = await current.screenshot({ type: "jpeg", quality, scale: "css" });
    if (buf.byteLength <= max || quality === 20) {
      return { mime: "image/jpeg", base64: buf.toString("base64") };
    }
  }
  return null;
}

async function clickTarget(current, target) {
  const name = typeof target.name === "string" ? target.name.trim() : "";
  const selector = typeof target.selector === "string" ? target.selector.trim() : "";
  const role = typeof target.role === "string" ? target.role.trim().toLowerCase() : "";
  if (name) {
    const roles = role ? [role] : ["button", "link", "checkbox"];
    for (const r of roles) {
      const loc = current.getByRole(r, { name, exact: false }).first();
      try {
        await loc.waitFor({ state: "visible", timeout: 4_000 });
        await loc.click({ timeout: 15_000 });
        return;
      } catch {
        // next
      }
    }
    await current.getByText(name, { exact: true }).first().click({ timeout: 15_000 });
    return;
  }
  if (!selector) throw new Error("name か selector が要る");
  await current.locator(selector).first().click({ timeout: 15_000 });
}

async function snapOf(current) {
  const url = current.url();
  const title = await current.title().catch(() => "");
  let text = "";
  try {
    text = (await current.locator("body").ariaSnapshot({ timeout: 5_000 })) || "";
  } catch {
    text = (await current.locator("body").innerText().catch(() => "")).slice(0, 10_000);
  }
  return { url, title, text, truncated: false };
}

function steelInteractiveDebugUrl(created) {
  const raw = typeof created.debugUrl === "string" ? created.debugUrl.trim() : "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    // WebRTC プレイヤーは hideInteractionDialog のみ有効。ゲートが残るとキーが握られる。
    url.searchParams.delete("interactive");
    url.searchParams.delete("showControls");
    url.searchParams.set("hideInteractionDialog", "true");
    return url.toString();
  } catch {
    const join = raw.includes("?") ? "&" : "?";
    return `${raw}${join}hideInteractionDialog=true`;
  }
}

function livePlayerPublicBase(req) {
  const explicit = process.env.FUDO_BROWSER_ACT_PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const host = req?.headers?.host;
  if (!host) return "";
  const proto = req.headers["x-forwarded-proto"] || "http";
  return `${proto}://${host}`;
}

function wrapLivePlayerUrl(debugUrl, req) {
  if (!debugUrl) return null;
  if (debugUrl.includes("/live-player")) return debugUrl;
  try {
    const u = new URL(debugUrl);
    if (u.protocol !== "https:" || u.hostname !== "api.steel.dev" || !u.pathname.includes("/player/")) {
      return debugUrl;
    }
  } catch {
    return debugUrl;
  }
  const base = livePlayerPublicBase(req);
  if (!base) return debugUrl;
  return `${base}/live-player?src=${encodeURIComponent(debugUrl)}`;
}

function assertSteelPlayerUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("steel_player_url_invalid");
  if (url.hostname !== "api.steel.dev") throw new Error("steel_player_url_invalid");
  if (!url.pathname.includes("/player/")) throw new Error("steel_player_url_invalid");
  return url.toString();
}

/** 公式プレイヤーは composition 中に hiddenInput を空にして日本語 IME を壊す。 */
function patchSteelPlayerHtml(html) {
  if (!html.includes("hiddenInput") || !html.includes("sendTextInsert")) {
    throw new Error("steel_player_unexpected");
  }
  if (html.includes("imeComposing")) return html;
  const beforeOld = `hiddenInput.addEventListener("beforeinput", (e) => {
          if (!interactionsEnabled()) {
            e.preventDefault();
            return;
          }
          if (e.data) {
            textBuffer += e.data;
            if (pendingInsert) cancelAnimationFrame(pendingInsert);
            pendingInsert = requestAnimationFrame(() => {
              flushTextBuffer();
              pendingInsert = null;
            });
          } else if (e.inputType === "deleteContentBackward") {
            flushTextBuffer();
            sendInteractionPayload({
              type: "keyboardEvent",
              event: {
                action: "keyPress",
                key: "Backspace",
                code: "Backspace",
                keyCode: 8,
                modifiers: 0,
              },
            });
          }
        });`;
  const beforeNew = `let imeComposing = false;
        hiddenInput.addEventListener("compositionstart", () => {
          imeComposing = true;
        });
        hiddenInput.addEventListener("compositionend", (e) => {
          imeComposing = false;
          if (!interactionsEnabled()) return;
          flushTextBuffer();
          if (e.data) sendTextInsert(e.data);
          hiddenInput.value = "";
        });
        hiddenInput.addEventListener("beforeinput", (e) => {
          if (!interactionsEnabled()) {
            e.preventDefault();
            return;
          }
          if (
            imeComposing ||
            e.isComposing ||
            e.inputType === "insertCompositionText" ||
            e.inputType === "deleteCompositionText" ||
            e.inputType === "insertFromComposition"
          ) {
            return;
          }
          if (e.data) {
            textBuffer += e.data;
            if (pendingInsert) cancelAnimationFrame(pendingInsert);
            pendingInsert = requestAnimationFrame(() => {
              flushTextBuffer();
              pendingInsert = null;
            });
          } else if (e.inputType === "deleteContentBackward") {
            flushTextBuffer();
            sendInteractionPayload({
              type: "keyboardEvent",
              event: {
                action: "keyPress",
                key: "Backspace",
                code: "Backspace",
                keyCode: 8,
                modifiers: 0,
              },
            });
          }
        });`;
  const inputOld = `hiddenInput.addEventListener("input", () => {
          hiddenInput.value = "";
        });`;
  const inputNew = `hiddenInput.addEventListener("input", () => {
          if (imeComposing) return;
          hiddenInput.value = "";
        });`;
  if (!html.includes(beforeOld) || !html.includes(inputOld)) {
    throw new Error("steel_player_handlers_changed");
  }
  return html.replace(beforeOld, beforeNew).replace(inputOld, inputNew);
}

async function createRemoteSession() {
  const response = await fetch(`${base}/v1/sessions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "steel-api-key": apiKey,
      accept: "application/json",
      "user-agent": "fudo-browser-act/1.0"
    },
    body: JSON.stringify({
      timeout: 600_000,
      inactivityTimeout: 300_000,
      debugConfig: { interactive: true, systemCursor: true }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id) {
    throw new Error(data.message || data.error || `steel_session_http_${response.status}`);
  }
  return data;
}

async function releaseRemoteSession(id) {
  await fetch(`${base}/v1/sessions/${encodeURIComponent(id)}/release`, {
    method: "POST",
    headers: { "steel-api-key": apiKey, "user-agent": "fudo-browser-act/1.0" }
  }).catch(() => undefined);
}

async function closeSession() {
  closed = true;
  const b = browser;
  const id = steelId;
  browser = null;
  page = null;
  steelId = null;
  websocketUrl = null;
  viewerUrl = null;
  if (b) await b.close().catch(() => undefined);
  if (id) await releaseRemoteSession(id);
  closed = false;
}

function authorized(req) {
  const raw = req.headers.authorization ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  return Boolean(m && m[1] === actToken);
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/health" || req.url?.startsWith("/health?"))) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  // 認証不要（Steel debugUrl と同じく URL 知っていれば触れる）。IME パッチ済みプレイヤー。
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
  if (!authorized(req)) {
    res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  try {
    const body = await readJson(req);
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/navigate") {
      const current = await ensurePage();
      await current.goto(String(body.url || ""), { waitUntil: "domcontentloaded", timeout: 20_000 });
      await current
        .getByRole("button", { name: /同意する|Agree|Accept/i })
        .first()
        .waitFor({ state: "visible", timeout: 8_000 })
        .catch(() => undefined);
      await delay(200);
      json(res, 200, await snapOf(current));
      return;
    }
    if (path === "/snapshot") {
      json(res, 200, await snapOf(await ensurePage()));
      return;
    }
    if (path === "/click") {
      const current = await ensurePage();
      await clickTarget(current, body);
      await delay(200);
      json(res, 200, { url: current.url(), title: await current.title().catch(() => "") });
      return;
    }
    if (path === "/type") {
      const current = await ensurePage();
      const loc = current.locator(String(body.selector || "")).first();
      await loc.fill(String(body.text || ""), { timeout: 10_000 });
      if (body.submit === true) await loc.press("Enter");
      await delay(200);
      json(res, 200, { url: current.url(), title: await current.title().catch(() => "") });
      return;
    }
    if (path === "/scroll") {
      const current = await ensurePage();
      const direction = body.direction === "up" || body.direction === "down" ? body.direction : "";
      if (!direction) {
        json(res, 400, { error: "direction required" });
        return;
      }
      const rawAmount = typeof body.amount === "number" ? body.amount : 600;
      const amount = Math.max(1, Math.min(rawAmount, 4000));
      const delta = direction === "up" ? -amount : amount;
      const selector = typeof body.selector === "string" ? body.selector.trim() : "";
      await current.evaluate(
        ({ delta: d, selector: sel }) => {
          if (sel) {
            const el = document.querySelector(sel);
            if (el) {
              el.scrollBy(0, d);
              return;
            }
          }
          window.scrollBy(0, d);
        },
        { delta, selector }
      );
      await delay(200);
      json(res, 200, { url: current.url(), title: await current.title().catch(() => "") });
      return;
    }
    if (path === "/select") {
      const current = await ensurePage();
      const selector = String(body.selector || "").trim();
      const value = typeof body.value === "string" ? body.value.trim() : "";
      const label = typeof body.label === "string" ? body.label.trim() : "";
      if (!selector) {
        json(res, 400, { error: "selector required" });
        return;
      }
      if (!value && !label) {
        json(res, 400, { error: "value or label required" });
        return;
      }
      const loc = current.locator(selector).first();
      if (value) await loc.selectOption(value, { timeout: 10_000 });
      else await loc.selectOption({ label }, { timeout: 10_000 });
      await delay(200);
      json(res, 200, { url: current.url(), title: await current.title().catch(() => "") });
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
      // handoff 中は新規セッションを作らない（Live View と別ページに打つ事故を防ぐ）
      const current = await reconnectExisting();
      await insertTextIntoPage(current, value);
      await detachForHandoff();
      json(res, 200, { ok: true });
      return;
    }
    if (path === "/screenshot") {
      const current = await ensurePage();
      const shot = await screenshotOf(current);
      json(res, 200, shot ?? { mime: null, base64: null });
      return;
    }
    if (path === "/live-view") {
      await ensurePage();
      json(res, 200, { url: wrapLivePlayerUrl(viewerUrl, req) });
      return;
    }
    if (path === "/detach") {
      await detachForHandoff();
      json(res, 200, { detached: true });
      return;
    }
    if (path === "/close") {
      await closeSession();
      json(res, 200, { closed: true });
      return;
    }
    res.writeHead(404).end();
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message.slice(0, 300) : "browser_act_failed" });
  }
});

server.listen(port, host, () => {
  console.log(`browser-act http://${host}:${port}`);
});

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 64_000) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}
