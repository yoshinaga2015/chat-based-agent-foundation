// スレッド名は対話と同じモデル（AGENT_CHAT_MODEL）で一度だけ付ける。
import { readChatOutput, samplingParams } from "./chat";
import type { ChatConfig } from "./config";

export const DEFAULT_THREAD_TITLE = "新しい会話";

const TITLE_MAX_CHARS = 24;
const USER_SNIPPET = 400;

export function sanitizeThreadTitle(raw: string): string | null {
  let text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  text = text.split(/\n/)[0]?.trim() ?? "";
  text = text.replace(/^["'「『]+/, "").replace(/["'」』]+$/, "").trim();
  text = text.replace(/[。．.!?！？]+$/u, "").trim();
  if (!text || text === DEFAULT_THREAD_TITLE) return null;
  const chars = Array.from(text);
  if (chars.length < 2) return null;
  if (chars.length > TITLE_MAX_CHARS) text = chars.slice(0, TITLE_MAX_CHARS).join("");
  return text;
}

export function fallbackThreadTitle(userText: string): string | null {
  const line = userText.replace(/\s+/g, " ").trim().split(/\n/)[0]?.trim() ?? "";
  if (!line || line === "（添付のみ）") return null;
  return sanitizeThreadTitle(line) ?? sanitizeThreadTitle(Array.from(line).slice(0, TITLE_MAX_CHARS).join(""));
}

/** 短い会話タイトルを返す。失敗時はヒューリスティック、それも無理なら null。 */
export async function suggestThreadTitle(
  config: ChatConfig,
  input: { userText: string; assistantText?: string }
): Promise<{ title: string | null; tokens: number }> {
  const user = input.userText.trim().slice(0, USER_SNIPPET);
  const fallback = fallbackThreadTitle(user);
  if (!user || user === "（添付のみ）") {
    return { title: fallback, tokens: 0 };
  }

  try {
    const assistant = (input.assistantText ?? "").trim().slice(0, 200);
    const output = readChatOutput(
      await config.ai.run(config.model, {
        ...samplingParams(config.model, 40, 0.2),
        messages: [
          {
            role: "system",
            content:
              "あなたはチャットの会話名を付ける。日本語で短い名詞句だけを返す。説明・引用符・句点・絵文字は付けない。20文字以内。"
          },
          {
            role: "user",
            content: assistant
              ? `ユーザー: ${user}\n助手: ${assistant}\n\n会話名:`
              : `ユーザー: ${user}\n\n会話名:`
          }
        ]
      })
    );
    const title = output.content ? sanitizeThreadTitle(output.content) : null;
    return { title: title ?? fallback, tokens: output.tokens };
  } catch {
    return { title: fallback, tokens: 0 };
  }
}
