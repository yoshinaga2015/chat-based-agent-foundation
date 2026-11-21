// AI バインディングで対話モデルを呼ぶ。OpenAI 互換と Workers AI 旧形式の両方の応答を読む。
import type { ChatConfig } from "./config";
import { tokensFromChatUsage } from "./usage";

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | ChatContentPart[];
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletion {
  content: string | null;
  toolCalls: ChatToolCall[];
  /** プロバイダ usage の合計。無いときは 0。 */
  tokens: number;
}

export type ChatComplete = (input: {
  messages: ChatMessage[];
  tools: ChatToolDef[];
}) => Promise<ChatCompletion>;

export function aiChat(config: ChatConfig): ChatComplete {
  return async ({ messages, tools }) => {
    const output = await config.ai.run(config.model, {
      messages,
      ...(tools.length > 0
        ? {
            tools,
            tool_choice: "auto",
            // GPT-6 Luna は、ツール呼び出し時 reasoning を none にする必要がある
            ...(config.model.startsWith("openai/") ? { reasoning_effort: "none" } : {})
          }
        : {})
    });
    return readChatOutput(output);
  };
}

/** 出力の上限と温度。openai/ の推論モデルは max_tokens と temperature を受け付けず、推論が上限を食い切る。 */
export function samplingParams(model: string, maxTokens: number, temperature: number): Record<string, number | string> {
  return model.startsWith("openai/")
    ? { max_completion_tokens: maxTokens, reasoning_effort: "none" }
    : { max_tokens: maxTokens, temperature };
}

type RawToolCall = {
  id?: unknown;
  name?: unknown;
  arguments?: unknown;
  function?: { name?: unknown; arguments?: unknown };
};

export function readChatOutput(output: unknown): ChatCompletion {
  const record = (output && typeof output === "object" ? output : {}) as {
    choices?: { message?: { content?: unknown; tool_calls?: RawToolCall[] } }[];
    response?: unknown;
    tool_calls?: RawToolCall[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const message = record.choices?.[0]?.message;
  const content = message ? message.content : record.response;
  const rawCalls = message ? message.tool_calls : record.tool_calls;
  return {
    content: typeof content === "string" ? content : content == null ? null : JSON.stringify(content),
    toolCalls: (Array.isArray(rawCalls) ? rawCalls : []).flatMap((call, index) => toolCall(call, index)),
    tokens: tokensFromChatUsage(record.usage)
  };
}

function toolCall(raw: RawToolCall, index: number): ChatToolCall[] {
  const name = raw.function?.name ?? raw.name;
  if (typeof name !== "string" || !name) return [];
  const args = raw.function?.arguments ?? raw.arguments ?? {};
  return [
    {
      id: typeof raw.id === "string" && raw.id ? raw.id : `call_${index}_${name}`,
      type: "function",
      function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) }
    }
  ];
}
