// Workers AI typesafe/jev（構造化判定）。落ちているときは "down"（保存を許す）。
import { installedAi, type AiBinding } from "./config";

export type JevVerdict = boolean | "down";
export type JevFn = (plan: string) => JevVerdict | Promise<JevVerdict>;

const SAVE_QUESTION = {
  save_intent: {
    type: "noul",
    instructions: "この実行計画に、台帳・ノート・メモ・レコードへの保存または書き込みの意図があるか。",
    criteria: {
      true: "台帳やレコードを保存・更新・作成する",
      false: "読むだけ・調査だけ・書き込みなし"
    }
  }
} as const;

/** noul の確率。高いほど保存意図あり。中間帯は down。 */
const YES = 0.6;
const NO = 0.4;

/** 実行計画文に保存意図があるか。false = 拒否、true = 承認待ちへ、down = 判定不能で通す。 */
export function aiJev(ai: AiBinding): JevFn {
  return async (plan) => {
    try {
      const output = await ai.run("typesafe/jev", { state: plan, questions: SAVE_QUESTION }) as {
        answers?: { save_intent?: { noul?: number } };
        result?: { answers?: { save_intent?: { noul?: number } } };
      } | null;
      const noul = output?.answers?.save_intent?.noul ?? output?.result?.answers?.save_intent?.noul;
      if (typeof noul !== "number" || !Number.isFinite(noul)) return "down";
      if (noul >= YES) return true;
      if (noul <= NO) return false;
      return "down";
    } catch {
      return "down";
    }
  };
}

export function productJev(): JevFn {
  const ai = installedAi();
  return ai ? aiJev(ai) : () => "down";
}
