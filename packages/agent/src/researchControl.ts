/** 調査コントローラー（決定論的）。ホスト分散・カバレッジ・ギャップ誘導。 */

import { MAX_FETCH_SUCCESS_PER_HOST } from "./limits";
import { hostnameOf } from "./researchGuidance";
import type { WebFact } from "./webFacts";

export type ResearchQueryClass = "single" | "series" | "market";

export type FetchHostPolicy =
  | { ok: true }
  | { ok: false; reason: "failed_host" | "host_success_cap"; detail: string };

export type FailureLedgerEntry = {
  host: string;
  url: string;
  reason: string;
};

export type CoverageStatus = {
  queryClass: ResearchQueryClass;
  met: boolean;
  datedFactCount: number;
  distinctDates: number;
  successHosts: number;
  need: { datedFacts: number; distinctDates: number; hosts: number };
};

export function classifyResearchQuery(userText: string): ResearchQueryClass {
  const t = userText.trim();
  if (/推移|ここ数週|数週|週次|時系列|過去\s*\d|トレンド|動き|比較/i.test(t)) return "series";
  if (/相場|目安|中央値|賃料|家賃|坪単価|平米単価|成約/i.test(t)) return "market";
  if (/最新|公表|政策金利|CPI|消費者物価|終値|株価|指標|統計/i.test(t)) return "single";
  // 曖昧は厳しい側（推移）へ
  if (/数値|出典|調べ|確認|まとめて/i.test(t)) return "series";
  return "single";
}

export function coverageNeed(queryClass: ResearchQueryClass): CoverageStatus["need"] {
  if (queryClass === "series") return { datedFacts: 3, distinctDates: 3, hosts: 2 };
  if (queryClass === "market") return { datedFacts: 1, distinctDates: 0, hosts: 2 };
  return { datedFacts: 1, distinctDates: 1, hosts: 1 };
}

export function evaluateCoverage(input: {
  queryClass: ResearchQueryClass;
  facts: readonly (WebFact & { sourceUrl?: string })[];
  successHosts: readonly string[];
}): CoverageStatus {
  const need = coverageNeed(input.queryClass);
  const dated = input.facts.filter((f) => Boolean(f.asOf?.trim()));
  const dates = new Set(dated.map((f) => f.asOf!.trim()));
  const hosts = new Set(input.successHosts.map((h) => h.toLowerCase()).filter(Boolean));
  const datedFactCount = dated.length;
  const distinctDates = dates.size;
  const successHosts = hosts.size;
  const met =
    datedFactCount >= need.datedFacts &&
    distinctDates >= need.distinctDates &&
    successHosts >= need.hosts;
  return {
    queryClass: input.queryClass,
    met,
    datedFactCount,
    distinctDates,
    successHosts,
    need
  };
}

export function assertFetchHost(input: {
  url: string;
  failedHosts: readonly string[];
  successByHost: Readonly<Record<string, number>>;
  maxSuccessPerHost?: number;
}): FetchHostPolicy {
  const host = hostnameOf(input.url);
  if (!host) return { ok: true };
  const failed = new Set(input.failedHosts.map((h) => h.toLowerCase()));
  if (failed.has(host)) {
    return {
      ok: false,
      reason: "failed_host",
      detail: `同一ターンで失敗済みホスト（${host}）。未精読の別ホスト URL を選ぶ。`
    };
  }
  const cap = input.maxSuccessPerHost ?? MAX_FETCH_SUCCESS_PER_HOST;
  const used = input.successByHost[host] ?? 0;
  if (used >= cap) {
    return {
      ok: false,
      reason: "host_success_cap",
      detail: `ホスト ${host} の精読成功が上限（${cap}）。別ホストを選ぶ。`
    };
  }
  return { ok: true };
}

/** 精読上限、または検索上限かつ未試行ホスト候補なし。 */
export function researchBudgetExhausted(input: {
  searches: number;
  searchMax: number;
  fetches: number;
  fetchMax: number;
  unusedCandidateHosts: number;
}): boolean {
  if (input.fetches >= input.fetchMax) return true;
  if (input.searches >= input.searchMax && input.unusedCandidateHosts <= 0) return true;
  return false;
}

export function formatFailureLedger(entries: readonly FailureLedgerEntry[]): string {
  if (!entries.length) return "";
  const lines = entries.slice(0, 8).map((e) => `- ${e.host}: ${e.reason}`);
  return `試行レジャー:\n${lines.join("\n")}`;
}

export function buildGapQueryGuidance(input: {
  coverage: CoverageStatus;
  searchLeft: number;
}): string | null {
  if (input.coverage.met || input.searchLeft <= 0) return null;
  const { need, datedFactCount, distinctDates, successHosts, queryClass } = input.coverage;
  const gaps: string[] = [];
  if (datedFactCount < need.datedFacts || distinctDates < need.distinctDates) {
    gaps.push(
      queryClass === "series"
        ? "日付付きの終値・公表値の履歴ページ"
        : "日付付きの一次公表値・公式統計"
    );
  }
  if (successHosts < need.hosts) {
    gaps.push("未精読ドメインの一次ソース");
  }
  if (!gaps.length) return null;
  return `カバレッジ未達。次の web_search は「${gaps.join("／")}」を主題にクエリを変える（同趣旨連打禁止）。`;
}

export function unusedCandidateHostCount(input: {
  candidateUrls: readonly string[];
  triedHosts: readonly string[];
}): number {
  const tried = new Set(input.triedHosts.map((h) => h.toLowerCase()));
  const unused = new Set<string>();
  for (const url of input.candidateUrls) {
    const host = hostnameOf(url);
    if (host && !tried.has(host)) unused.add(host);
  }
  return unused.size;
}
