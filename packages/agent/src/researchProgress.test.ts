import { describe, expect, it } from "vitest";
import { createDesk } from "./desk";
import { DELEGATE_MAX } from "./delegate";
import { BROWSER_FETCH_PER_TURN, WEB_SEARCH_PER_TURN } from "./limits";
import { buildResearchProgress } from "./researchProgress";
import { runTurn } from "./turn";

const now = 1_700_000_000_000;

describe("buildResearchProgress", () => {
  it("search/fetch/delegate ゼロなら null", () => {
    expect(
      buildResearchProgress({
        searches: 0,
        browserFetches: 0,
        delegates: 0,
        searchMax: WEB_SEARCH_PER_TURN,
        fetchMax: BROWSER_FETCH_PER_TURN,
        hasFetchSources: false,
        hasFacts: false
      })
    ).toBeNull();
  });

  it("search のみなら search done・fetch pending", () => {
    const part = buildResearchProgress({
      searches: 2,
      browserFetches: 0,
      searchMax: WEB_SEARCH_PER_TURN,
      fetchMax: BROWSER_FETCH_PER_TURN,
      hasFetchSources: false,
      hasFacts: false
    });
    expect(part?.meters).toEqual([
      { id: "web_search", label: "検索", used: 2, max: WEB_SEARCH_PER_TURN },
      { id: "browser_fetch", label: "ページ", used: 0, max: BROWSER_FETCH_PER_TURN }
    ]);
    expect(part?.phases.find((p) => p.id === "search")?.state).toBe("done");
    expect(part?.phases.find((p) => p.id === "fetch")?.state).toBe("pending");
    expect(part?.phases.find((p) => p.id === "synthesize")?.state).toBe("pending");
    expect(part?.phases.find((p) => p.id === "delegate")).toBeUndefined();
  });

  it("delegate のみでも job_progress と委任メータが出る", () => {
    const part = buildResearchProgress({
      searches: 0,
      browserFetches: 0,
      delegates: 2,
      hasFetchSources: false,
      hasFacts: false
    });
    expect(part?.phases.find((p) => p.id === "delegate")).toMatchObject({
      label: "並行",
      state: "done"
    });
    expect(part?.meters.find((m) => m.id === "delegate")).toEqual({
      id: "delegate",
      label: "並行",
      used: 2,
      max: DELEGATE_MAX
    });
  });

  it("従来: fetch sources または facts があれば synthesize done", () => {
    const part = buildResearchProgress({
      searches: 1,
      browserFetches: 1,
      searchMax: WEB_SEARCH_PER_TURN,
      fetchMax: BROWSER_FETCH_PER_TURN,
      hasFetchSources: true,
      hasFacts: false
    });
    expect(part?.phases.find((p) => p.id === "fetch")?.state).toBe("done");
    expect(part?.phases.find((p) => p.id === "synthesize")?.state).toBe("done");
  });

  it("coverage 未達かつ予算未尽なら synthesize pending", () => {
    const part = buildResearchProgress({
      searches: 1,
      browserFetches: 1,
      hasFetchSources: true,
      hasFacts: true,
      coverageMet: false,
      budgetExhausted: false
    });
    expect(part?.phases.find((p) => p.id === "synthesize")?.state).toBe("pending");
  });

  it("coverage 充足なら synthesize done", () => {
    const part = buildResearchProgress({
      searches: 2,
      browserFetches: 2,
      hasFetchSources: true,
      hasFacts: true,
      coverageMet: true,
      budgetExhausted: false
    });
    expect(part?.phases.find((p) => p.id === "synthesize")?.state).toBe("done");
  });

  it("runTurn で web_search すると job_progress が付く", () => {
    const desk = createDesk();
    const turn = runTurn({
      ledger: desk.ledger,
      now,
      userText: "公の情報を調べて",
      search: () => [{ url: "https://example.com/a", title: "例", snippet: "本文" }],
      steps: [
        { calls: [{ name: "web_search", args: { query: "公定歩合" } }] },
        { text: "要約です。" }
      ]
    });
    const progress = turn.uiParts.find((p) => p.kind === "job_progress");
    expect(progress?.kind).toBe("job_progress");
    if (progress?.kind !== "job_progress") return;
    expect(progress.meters.find((m) => m.id === "web_search")?.used).toBe(1);
    expect(progress.sourceTool).toBe("research_progress");
  });

  it("search なしのターンには job_progress が付かない", () => {
    const desk = createDesk();
    const turn = runTurn({
      ledger: desk.ledger,
      now,
      userText: "こんにちは",
      steps: [{ text: "こんにちは。" }]
    });
    expect(turn.uiParts.some((p) => p.kind === "job_progress")).toBe(false);
  });
});
