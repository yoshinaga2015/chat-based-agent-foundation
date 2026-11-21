import { describe, expect, it } from "vitest";
import { parseSpeakAttachments, userContentWithAttachments } from "./attach";

describe("チャット添付", () => {
  it("空は通す", () => {
    expect(parseSpeakAttachments(undefined)).toEqual({ ok: true, attachments: [] });
  });

  it("画像1枚を受理する", () => {
    const dataBase64 = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xd9));
    const parsed = parseSpeakAttachments([{ name: "a.jpg", media: "image/jpeg", dataBase64 }]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.attachments[0]?.name).toBe("a.jpg");
  });

  it("枚数超過は拒む", () => {
    const dataBase64 = "AAAA";
    expect(parseSpeakAttachments([
      { name: "a.png", media: "image/png", dataBase64 },
      { name: "b.png", media: "image/png", dataBase64 }
    ])).toEqual({ ok: false, reason: "too_many" });
  });

  it("画像は Chat Completions に載せない（観察文は呼び出し側）", () => {
    expect(userContentWithAttachments("見て", [
      { name: "x.png", media: "image/png", dataBase64: "qq==" }
    ])).toBe("見て");
  });

  it("PDF は注記だけ", () => {
    const content = userContentWithAttachments("", [
      { name: "deed.pdf", media: "application/pdf", dataBase64: "AAAA" }
    ]);
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;
    expect(content.some((part) => part.type === "text" && part.text.includes("deed.pdf"))).toBe(true);
    expect(content.some((part) => part.type === "image_url")).toBe(false);
  });
});
