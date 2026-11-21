// 出典はツール結果とユーザーの発話だけ。スキル本文は数に入れない。文は消さない。
import { ungroundedTokens, type NumberToken } from "./grounding";

export function reviewAnswer(input: {
  draft: string;
  sources: readonly number[];
  rewrite: (draft: string, missed: readonly NumberToken[]) => string;
}): { text: string; unconfirmed: NumberToken[] } {
  const missed = ungroundedTokens(input.draft, input.sources);
  if (missed.length === 0) return { text: input.draft, unconfirmed: [] };
  const rewritten = input.rewrite(input.draft, missed);
  return { text: rewritten, unconfirmed: ungroundedTokens(rewritten, input.sources) };
}
