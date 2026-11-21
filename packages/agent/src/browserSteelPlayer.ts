/**
 * Steel Live View プレイヤー HTML の IME パッチと公開 URL ラップ。
 * 公式プレイヤーは composition 中に hiddenInput を空にして日本語 IME を壊す。
 */

const BEFOREINPUT_OLD = `hiddenInput.addEventListener("beforeinput", (e) => {
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

const BEFOREINPUT_NEW = `let imeComposing = false;
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

const INPUT_OLD = `hiddenInput.addEventListener("input", () => {
          hiddenInput.value = "";
        });`;

const INPUT_NEW = `hiddenInput.addEventListener("input", () => {
          if (imeComposing) return;
          hiddenInput.value = "";
        });`;

/** Steel 公式プレイヤー HTML に日本語 IME（composition）対応を差し込む。 */
export function patchSteelPlayerHtml(html: string): string {
  if (!html.includes("hiddenInput") || !html.includes("sendTextInsert")) {
    throw new Error("steel_player_unexpected");
  }
  if (html.includes("imeComposing")) return html;
  if (!html.includes(BEFOREINPUT_OLD) || !html.includes(INPUT_OLD)) {
    throw new Error("steel_player_handlers_changed");
  }
  return html.replace(BEFOREINPUT_OLD, BEFOREINPUT_NEW).replace(INPUT_OLD, INPUT_NEW);
}

/** SSRF 防止。api.steel.dev の player URL のみ許可。 */
export function assertSteelPlayerUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("steel_player_url_invalid");
  if (url.hostname !== "api.steel.dev") throw new Error("steel_player_url_invalid");
  if (!url.pathname.includes("/player/")) throw new Error("steel_player_url_invalid");
  return url.toString();
}

/**
 * handoff 用に自前 /live-player へ向ける。
 * base が無ければ Steel 直リンクのまま。
 */
export function wrapSteelLivePlayerUrl(
  debugUrl: string | null,
  publicBase: string | undefined
): string | null {
  if (!debugUrl) return null;
  const base = publicBase?.trim().replace(/\/$/, "") ?? "";
  if (!base) return debugUrl;
  if (debugUrl.includes("/live-player")) return debugUrl;
  try {
    const u = new URL(debugUrl);
    if (u.protocol !== "https:" || u.hostname !== "api.steel.dev" || !u.pathname.includes("/player/")) {
      return debugUrl;
    }
  } catch {
    return debugUrl;
  }
  return `${base}/live-player?src=${encodeURIComponent(debugUrl)}`;
}
