import { describe, expect, it } from "vitest";
import {
  DEFAULT_THREAD_TITLE,
  fallbackThreadTitle,
  sanitizeThreadTitle,
  suggestThreadTitle
} from "./threadTitle";
import type { AiBinding, ChatConfig } from "./config";

function ai(run: AiBinding["run"]): ChatConfig {
  return { model: "m", ai: { run, websearch: async () => new Response("{}") } };
}

describe("sanitizeThreadTitle", () => {
  it("引用と句点を落として短くする", () => {
    expect(sanitizeThreadTitle("「足立区の路線価」")).toBe("足立区の路線価");
    expect(sanitizeThreadTitle("収支の確認。")).toBe("収支の確認");
  });

  it("デフォルト名と空は拒否", () => {
    expect(sanitizeThreadTitle(DEFAULT_THREAD_TITLE)).toBeNull();
    expect(sanitizeThreadTitle("  ")).toBeNull();
    expect(sanitizeThreadTitle("あ")).toBeNull();
  });

  it("長すぎる場合は切る", () => {
    const long = "あ".repeat(40);
    expect(sanitizeThreadTitle(long)?.length).toBe(24);
  });
});

describe("fallbackThreadTitle", () => {
  it("先頭を会話名にする", () => {
    expect(fallbackThreadTitle("全国地価マップで足立区を調べて")).toBe("全国地価マップで足立区を調べて");
  });

  it("添付のみは null", () => {
    expect(fallbackThreadTitle("（添付のみ）")).toBeNull();
  });
});

describe("suggestThreadTitle", () => {
  it("モデル応答を掃除する", async () => {
    const out = await suggestThreadTitle(
      ai(async () => ({
        choices: [{ message: { content: "「足立区の路線価」" } }],
        usage: { prompt_tokens: 20, completion_tokens: 5 }
      })),
      { userText: "足立区の路線価を調べて" }
    );
    expect(out.title).toBe("足立区の路線価");
    expect(out.tokens).toBe(25);
  });

  it("失敗時はフォールバック", async () => {
    const out = await suggestThreadTitle(
      ai(async () => {
        throw new Error("3040");
      }),
      { userText: "収支を確認したい" }
    );
    expect(out.title).toBe("収支を確認したい");
    expect(out.tokens).toBe(0);
  });

  it("openai/ には max_completion_tokens と reasoning_effort none を渡し、temperature を付けない", async () => {
    let sent: Record<string, unknown> = {};
    await suggestThreadTitle(
      {
        model: "openai/gpt-6-luna",
        ai: { run: async (_model, input) => { sent = input; return { choices: [{ message: { content: "例" } }] }; }, websearch: async () => new Response("{}") }
      },
      { userText: "example.com の用途" }
    );
    expect(sent.max_completion_tokens).toBe(40);
    expect(sent.reasoning_effort).toBe("none");
    expect(sent).not.toHaveProperty("max_tokens");
    expect(sent).not.toHaveProperty("temperature");
  });
});
