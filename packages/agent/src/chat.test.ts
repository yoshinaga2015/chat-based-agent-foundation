import { describe, expect, it } from "vitest";
import { aiChat, readChatOutput } from "./chat";
import type { AiBinding } from "./config";

function ai(output: unknown, seen: unknown[] = []): AiBinding {
  return {
    run: async (model, input) => {
      seen.push({ model, input });
      return output;
    },
    websearch: async () => new Response("{}")
  };
}

describe("aiChat", () => {
  it("OpenAI 互換の応答と usage を読む", async () => {
    const complete = aiChat({
      model: "m",
      ai: ai({ choices: [{ message: { content: "hi", tool_calls: [] } }], usage: { prompt_tokens: 7, completion_tokens: 3 } })
    });
    const out = await complete({ messages: [{ role: "user", content: "x" }], tools: [] });
    expect(out.content).toBe("hi");
    expect(out.tokens).toBe(10);
  });

  it("Workers AI 旧形式の tool_calls を OpenAI 形に揃える", () => {
    const out = readChatOutput({
      response: null,
      tool_calls: [{ name: "web_search", arguments: { query: "東京" } }],
      usage: { total_tokens: 12 }
    });
    expect(out.content).toBeNull();
    expect(out.toolCalls).toEqual([
      { id: "call_0_web_search", type: "function", function: { name: "web_search", arguments: "{\"query\":\"東京\"}" } }
    ]);
    expect(out.tokens).toBe(12);
  });

  it("reasoning_effort は openai/ のツール呼び出しだけに付ける", async () => {
    const seen: { model: string; input: Record<string, unknown> }[] = [];
    const tools = [{ type: "function" as const, function: { name: "t", description: "d", parameters: {} } }];
    await aiChat({ model: "openai/gpt-6-luna", ai: ai({ response: "a" }, seen) })({ messages: [], tools });
    await aiChat({ model: "@cf/zai-org/glm-4.7-flash", ai: ai({ response: "a" }, seen) })({ messages: [], tools });
    expect(seen[0]!.input.reasoning_effort).toBe("none");
    expect(seen[1]!.input.reasoning_effort).toBeUndefined();
  });
});
