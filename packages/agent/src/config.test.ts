import { afterEach, describe, expect, it } from "vitest";
import { CHAT_MODEL_CHOICES, DEFAULT_CHAT_MODEL, installAi, isSelectableChatModel, loadChatConfig } from "./config";

const ai = { run: async () => ({}), websearch: async () => new Response("{}") };

describe("loadChatConfig", () => {
  afterEach(() => installAi(null));

  it("バインディングが無ければ対話しない", () => {
    expect(loadChatConfig({}, CHAT_MODEL_CHOICES[1]!.id)).toBeNull();
  });

  it("スレッドで選んだモデルを使い、無ければ配備の既定", () => {
    installAi(ai);
    expect(loadChatConfig({}, "@cf/nvidia/nemotron-3-120b-a12b")?.model).toBe("@cf/nvidia/nemotron-3-120b-a12b");
    expect(loadChatConfig({})?.model).toBe(DEFAULT_CHAT_MODEL);
    expect(loadChatConfig({ AGENT_CHAT_MODEL: "openai/gpt-6-luna" })?.model).toBe("openai/gpt-6-luna");
  });

  it("一覧の外のモデル名は使わず、配備の既定に戻す", () => {
    installAi(ai);
    expect(loadChatConfig({}, "anthropic/claude-opus-9")?.model).toBe(DEFAULT_CHAT_MODEL);
  });
});

describe("isSelectableChatModel", () => {
  it("一覧と配備の既定だけ選べる", () => {
    expect(isSelectableChatModel({}, "@cf/zai-org/glm-4.7-flash")).toBe(true);
    expect(isSelectableChatModel({ AGENT_CHAT_MODEL: "@cf/meta/llama-9" }, "@cf/meta/llama-9")).toBe(true);
    expect(isSelectableChatModel({}, "@cf/meta/llama-9")).toBe(false);
  });
});
