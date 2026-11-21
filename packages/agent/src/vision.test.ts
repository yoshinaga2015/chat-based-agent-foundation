import { describe, expect, it } from "vitest";
import { describeSpeakAttachments } from "./vision";
import type { AiBinding } from "./config";

function ai(run: AiBinding["run"]): AiBinding {
  return { run, websearch: async () => new Response("{}") };
}

describe("画像観察", () => {
  it("画像を image_url で渡し、本文と usage を取り出す", async () => {
    let sent: unknown;
    const out = await describeSpeakAttachments({
      model: "openai/gpt-6-luna",
      ai: ai(async (_model, input) => {
        sent = input;
        return { choices: [{ message: { content: "白い壁に価格表がある。" } }], usage: { prompt_tokens: 100, completion_tokens: 20 } };
      })
    }, [{ name: "a.png", media: "image/png", dataBase64: "qq==" }]);
    expect(out.text).toBe("【添付画像の観察】\n白い壁に価格表がある。");
    expect(out.tokens).toBe(120);
    expect(JSON.stringify(sent)).toContain("data:image/png;base64,qq==");
  });

  it("画像が無ければ呼ばない", async () => {
    await expect(describeSpeakAttachments({
      model: "m",
      ai: ai(async () => {
        throw new Error("called");
      })
    }, [{ name: "a.pdf", media: "application/pdf", dataBase64: "AAAA" }])).resolves.toEqual({ text: null, tokens: 0 });
  });
});
