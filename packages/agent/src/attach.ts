// チャット添付。画像はマルチモーダル、PDF は台帳メタ＋注記（OCR は不動産段）。
import type { ChatContentPart } from "./chat";

export const SPEAK_ATTACH_MAX_BYTES = 3 * 1024 * 1024;
export const SPEAK_ATTACH_MAX_COUNT = 1;

export type AttachMedia = "image/png" | "image/jpeg" | "application/pdf";

export interface SpeakAttachment {
  name: string;
  media: AttachMedia;
  /** 生バイトの Base64（data: 接頭辞なし） */
  dataBase64: string;
}

export type AttachParse =
  | { ok: true; attachments: SpeakAttachment[] }
  | { ok: false; reason: "too_many" | "too_large" | "bad_media" | "bad_payload" };

const MEDIA = new Set<string>(["image/png", "image/jpeg", "application/pdf"]);

export function parseSpeakAttachments(raw: unknown): AttachParse {
  if (raw === undefined || raw === null) return { ok: true, attachments: [] };
  if (!Array.isArray(raw)) return { ok: false, reason: "bad_payload" };
  if (raw.length > SPEAK_ATTACH_MAX_COUNT) return { ok: false, reason: "too_many" };
  const attachments: SpeakAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return { ok: false, reason: "bad_payload" };
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const media = typeof row.media === "string" ? row.media : "";
    const dataBase64 = typeof row.dataBase64 === "string" ? row.dataBase64.replace(/\s/g, "") : "";
    if (!name || !dataBase64 || !MEDIA.has(media)) return { ok: false, reason: "bad_media" };
    const bytes = byteLengthOfBase64(dataBase64);
    if (bytes <= 0) return { ok: false, reason: "bad_payload" };
    if (bytes > SPEAK_ATTACH_MAX_BYTES) return { ok: false, reason: "too_large" };
    attachments.push({ name, media: media as AttachMedia, dataBase64 });
  }
  return { ok: true, attachments };
}

export function decodeAttachment(attachment: SpeakAttachment): Uint8Array {
  const binary = atob(attachment.dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * ライブターン用の user content。
 * Chat Completions は image を受け付けないため、画像は事前観察文を userText に載せる。
 * ここへ渡す attachments は PDF 注記用のみ。
 */
export function userContentWithAttachments(
  userText: string,
  attachments: readonly SpeakAttachment[] = []
): string | ChatContentPart[] {
  const pdfs = attachments.filter((item) => item.media === "application/pdf");
  if (pdfs.length === 0) return userText;
  const text = userText.trim() || "添付資料を確認し、内容に触れて短く答えてください。";
  const parts: ChatContentPart[] = [{ type: "text", text }];
  for (const attachment of pdfs) {
    parts.push({
      type: "text",
      text: `【添付PDF: ${attachment.name}】台帳に記録済み。画素読取は未接続のため、本文バイトはモデルへ渡しません。ファイル名だけを前提にしてください。`
    });
  }
  return parts;
}

function byteLengthOfBase64(data: string): number {
  try {
    return Math.floor((data.length * 3) / 4) - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
  } catch {
    return 0;
  }
}
