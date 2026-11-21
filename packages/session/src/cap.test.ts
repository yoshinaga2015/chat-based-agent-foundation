import { describe, expect, it } from "vitest";
import { TOKEN_CAP_MESSAGE } from "agent";
import { createSession, draftSpeak, viewOf } from "./session";

describe("日次トークン上限（session）", () => {
  it("viewOf に tokensToday / tokenCap を載せる", () => {
    const view = viewOf(createSession(), { tokensToday: 50, tokenCap: 100 }) as {
      tokensToday: number;
      tokenCap: number;
      tokenCapReached: boolean;
      tokenCapMessage: string;
    };
    expect(view.tokensToday).toBe(50);
    expect(view.tokenCap).toBe(100);
    expect(view.tokenCapReached).toBe(false);
    expect(view.tokenCapMessage).toBe(TOKEN_CAP_MESSAGE);
  });

  it("上限到達の view は tokenCapReached", () => {
    const view = viewOf(createSession(), { tokensToday: 100, tokenCap: 100 }) as {
      tokenCapReached: boolean;
    };
    expect(view.tokenCapReached).toBe(true);
  });

  it("draftSpeak は上限で complete を呼ばない", async () => {
    let calls = 0;
    const draft = await draftSpeak(
      createSession(),
      "こんにちは",
      Date.now(),
      async () => {
        calls += 1;
        return { content: "no", toolCalls: [], tokens: 1 };
      },
      [],
      { tokensToday: 1, tokenCap: 1 }
    );
    expect(calls).toBe(0);
    expect(draft.tokensUsed).toBe(0);
    expect(draft.tokens.join("")).toBe(TOKEN_CAP_MESSAGE);
  });
});
