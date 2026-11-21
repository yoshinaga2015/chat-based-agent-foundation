import { describe, expect, it } from "vitest";
import { aiJev } from "./jev";
import type { AiBinding } from "./config";

function ai(run: AiBinding["run"]): AiBinding {
  return { run, websearch: async () => new Response("{}") };
}

describe("Jev", () => {
  it("noul 高なら true", async () => {
    const jev = aiJev(ai(async () => ({ answers: { save_intent: { type: "noul", noul: 0.98 } } })));
    await expect(jev("ノートを保存する")).resolves.toBe(true);
  });

  it("noul 低なら false", async () => {
    const jev = aiJev(ai(async () => ({ result: { answers: { save_intent: { type: "noul", noul: 0.04 } } } })));
    await expect(jev("読むだけ")).resolves.toBe(false);
  });

  it("失敗は down", async () => {
    const jev = aiJev(ai(async () => {
      throw new Error("3040");
    }));
    await expect(jev("x")).resolves.toBe("down");
  });
});
