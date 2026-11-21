/** 調査／委任ターンの進捗（決定的）。モデル tool ではない。 */

import { DELEGATE_MAX } from "./delegate";
import { BROWSER_FETCH_PER_TURN, WEB_SEARCH_PER_TURN } from "./limits";

export type JobProgressPhase = {
  id: "plan" | "search" | "fetch" | "synthesize" | "delegate";
  label: string;
  state: "pending" | "active" | "done" | "skipped";
};

export type JobProgressMeter = {
  id: "web_search" | "browser_fetch" | "delegate";
  label: string;
  used: number;
  max: number;
};

export type JobProgressBody = {
  kind: "job_progress";
  phases: JobProgressPhase[];
  meters: JobProgressMeter[];
};

export function buildResearchProgress(input: {
  searches: number;
  browserFetches: number;
  delegates?: number;
  searchMax?: number;
  fetchMax?: number;
  delegateMax?: number;
  hasFetchSources: boolean;
  hasFacts: boolean;
  /** カバレッジ充足。未指定時は従来どおり sources/facts で合成完了。 */
  coverageMet?: boolean;
  /** 探索継続不能（予算尽 or 候補尽）。未指定時は coverage 未使用なら従来。 */
  budgetExhausted?: boolean;
}): JobProgressBody | null {
  const searches = Math.max(0, input.searches);
  const browserFetches = Math.max(0, input.browserFetches);
  const delegates = Math.max(0, input.delegates ?? 0);
  if (searches + browserFetches + delegates === 0) return null;

  const searchMax = input.searchMax ?? WEB_SEARCH_PER_TURN;
  const fetchMax = input.fetchMax ?? BROWSER_FETCH_PER_TURN;
  const delegateMax = input.delegateMax ?? DELEGATE_MAX;

  const searchDone = searches > 0;
  const fetchDone = browserFetches > 0;
  const delegateDone = delegates > 0;
  const hasEvidence = input.hasFetchSources || input.hasFacts;
  // カバレッジ制御あり: 充足 or 予算尽でのみ合成 done（早期欠測の見た目を抑止）
  const synthesizeDone =
    input.coverageMet !== undefined || input.budgetExhausted !== undefined
      ? Boolean(input.coverageMet) || Boolean(input.budgetExhausted)
      : hasEvidence;

  const phases: JobProgressPhase[] = [
    {
      id: "plan",
      label: "計画",
      state: searchDone || fetchDone || delegateDone ? "done" : "pending"
    },
    { id: "search", label: "検索", state: searchDone ? "done" : "pending" },
    { id: "fetch", label: "ページ", state: fetchDone ? "done" : "pending" },
    {
      id: "synthesize",
      label: "まとめ",
      state: synthesizeDone ? "done" : "pending"
    }
  ];

  if (delegateDone) {
    phases.push({ id: "delegate", label: "並行", state: "done" });
  }

  // 画面に出すのは回数メータのみ（計画／まとめの内部フェーズはユーザー向けにしない）
  const meters: JobProgressMeter[] = [
    {
      id: "web_search",
      label: "検索",
      used: Math.min(searches, searchMax),
      max: searchMax
    },
    {
      id: "browser_fetch",
      label: "ページ",
      used: Math.min(browserFetches, fetchMax),
      max: fetchMax
    }
  ];

  if (delegateDone) {
    meters.push({
      id: "delegate",
      label: "並行",
      used: Math.min(delegates, delegateMax),
      max: delegateMax
    });
  }

  return { kind: "job_progress", phases, meters };
}
