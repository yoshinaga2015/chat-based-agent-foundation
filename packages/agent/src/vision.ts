// 添付画像は対話の前に観察文へ落としてから載せる。
import { readChatOutput, type ChatContentPart } from "./chat";
import type { ChatConfig } from "./config";
import type { SpeakAttachment } from "./attach";

export type VisionDescribe = {
  text: string | null;
  tokens: number;
};

export async function describeSpeakAttachments(
  config: ChatConfig,
  attachments: readonly SpeakAttachment[]
): Promise<VisionDescribe> {
  const images = attachments.filter((item) => item.media === "image/png" || item.media === "image/jpeg");
  if (images.length === 0) return { text: null, tokens: 0 };

  const content: ChatContentPart[] = [
    {
      type: "text",
      text: "添付画像の内容を日本語で短く述べよ。見える文字・数値・図表は省略せず書く。推測は推測と明示する。"
    },
    ...images.map((image): ChatContentPart => ({
      type: "image_url",
      image_url: { url: `data:${image.media};base64,${image.dataBase64}` }
    }))
  ];
  const output = readChatOutput(await config.ai.run(config.model, { messages: [{ role: "user", content }] }));
  const text = output.content?.trim() ?? "";
  return { text: text ? `【添付画像の観察】\n${text}` : null, tokens: output.tokens };
}
