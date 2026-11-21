import { describe, expect, it } from "vitest";
import {
  activityKindForTool,
  beginToolProgress,
  describeToolActivity,
  finishToolProgress
} from "./activity";

describe("activity ラベル", () => {
  it("ツール名を kind に対応付ける", () => {
    expect(activityKindForTool("mcp_call")).toBe("mcp");
    expect(activityKindForTool("read_records")).toBe("memory");
    expect(activityKindForTool("start_job")).toBe("automation");
    expect(activityKindForTool("run_agent")).toBe("cli");
    expect(activityKindForTool("unknown_x")).toBe("other");
  });

  it("run_agent は Claude Code 名でラベルする", () => {
    const running = describeToolActivity("run_agent", { agent: "claude-code", prompt: "要約" }, "running");
    expect(running.kind).toBe("cli");
    expect(running.label).toBe("Claude Code に依頼しています");
    const done = describeToolActivity("run_agent", { agent: "claude-code", prompt: "要約" }, "ok");
    expect(done.label).toBe("Claude Code が応答した");
  });

  it("run_agent の書き込み保留は「応答した」と出さない", () => {
    const args = { agent: "claude-code", prompt: "直して", mode: "workspace-write" };
    const started = beginToolProgress("run_agent", args, [], "a-hold");
    const held = finishToolProgress(started, { ok: true, plan_pending: true, note: "書き込みは承認後に実行" }, args);
    expect(held.label).toBe("Claude Code の書き込みは承認待ち");
    expect(held.quote).toBe("直して");
  });

  it("MCP はサーバ表示名でラベルする", () => {
    const servers = [{ id: "slack", name: "Slack" }];
    const running = describeToolActivity("mcp_call", { server: "slack", name: "chat_postMessage" }, "running", servers);
    expect(running.kind).toBe("mcp");
    expect(running.target).toBe("Slack");
    expect(running.label).toBe("Slack を使っています");
    const done = describeToolActivity("mcp_call", { server: "slack", name: "chat_postMessage" }, "ok", servers);
    expect(done.label).toBe("Slack を使った");
  });

  it("スキル参照は名前を入れる", () => {
    const row = describeToolActivity("read_skill_resource", { name: "金利メモ" }, "running");
    expect(row.kind).toBe("skill");
    expect(row.label).toBe("スキル「金利メモ」を参照しています");
  });

  it("delegate_tasks は件数付きで並行と出す", () => {
    expect(activityKindForTool("delegate_tasks")).toBe("other");
    const running = describeToolActivity(
      "delegate_tasks",
      { tasks: [{ id: "a", goal: "g1" }, { id: "b", goal: "g2" }] },
      "running"
    );
    expect(running.label).toBe("2件を並行しています");
    const done = describeToolActivity(
      "delegate_tasks",
      { tasks: [{ id: "a", goal: "g1" }, { id: "b", goal: "g2" }] },
      "ok"
    );
    expect(done.label).toBe("2件を並行した");
  });

  it("begin / finish で同一 id の状態遷移", () => {
    const started = beginToolProgress("web_search", { query: "住宅ローン 金利" }, [], "a1");
    expect(started.id).toBe("a1");
    expect(started.status).toBe("running");
    expect(started.label).toContain("検索しています");
    const done = finishToolProgress(started, { ok: true, results: [] }, { query: "住宅ローン 金利" });
    expect(done.id).toBe("a1");
    expect(done.status).toBe("ok");
    expect(done.ok).toBe(true);
    const fail = finishToolProgress(started, { ok: false, reason: "timeout" }, { query: "x" });
    expect(fail.status).toBe("fail");
    expect(fail.ok).toBe(false);
  });

  it("hold_for_confirm は失敗にしない", () => {
    const started = beginToolProgress("run_calc", { name: "proforma.yearly" }, [], "a2");
    const held = finishToolProgress(started, { ok: false, reason: "hold_for_confirm" }, { name: "proforma.yearly" });
    expect(held.status).toBe("ok");
    expect(held.ok).toBe(true);
    expect(held.label).toBe("確認が必要");
  });

  it("inputs_missing は失敗にしない", () => {
    const started = beginToolProgress("run_calc", { name: "proforma.yearly" }, [], "a3");
    const missing = finishToolProgress(started, { ok: false, reason: "inputs_missing" }, { name: "proforma.yearly" });
    expect(missing.status).toBe("ok");
    expect(missing.label).toBe("項目が不足");
  });

  it("browser の 429 は取得制限と出す", () => {
    const started = beginToolProgress(
      "browser_navigate",
      { url: "https://www.nikkei.com/" },
      [],
      "a4"
    );
    const fail = finishToolProgress(
      started,
      {
        ok: false,
        reason: "act_error",
        detail: { constraint: "Browser Run の取得制限（429）。約 12 秒後に再試行できる。" }
      },
      { url: "https://www.nikkei.com/" }
    );
    expect(fail.status).toBe("fail");
    expect(fail.label).toBe("Browser Run の取得制限（約 12 秒）");
  });

  it("到達不能は専用ラベル", () => {
    const started = beginToolProgress(
      "browser_navigate",
      { url: "https://www.chikamap.jp/" },
      [],
      "a5"
    );
    const fail = finishToolProgress(
      started,
      {
        ok: false,
        reason: "act_error",
        detail: { constraint: "Navigation timeout", unreachable: true }
      },
      { url: "https://www.chikamap.jp/" }
    );
    expect(fail.label).toBe("この環境からは開けなかった");
  });

  it("Steel 退避成功はラベルに出す", () => {
    const started = beginToolProgress(
      "browser_navigate",
      { url: "https://example.com/" },
      [],
      "a6"
    );
    const ok = finishToolProgress(
      started,
      {
        ok: true,
        result: { url: "https://example.com/", title: "x", text: "", truncated: false },
        detail: { backend: "steel" }
      },
      { url: "https://example.com/" },
      [],
      undefined,
      "https://live.example/view"
    );
    expect(ok.label).toBe("Steel に切り替えて example.com を開いた");
    expect(ok.liveViewUrl).toBe("https://live.example/view");
  });

  it("埋め込み不可の liveViewUri は載せない", () => {
    const started = beginToolProgress("browser_navigate", { url: "https://example.com/" }, [], "a7");
    const ok = finishToolProgress(
      started,
      { ok: true, result: { url: "https://example.com/", title: "x", text: "", truncated: false } },
      { url: "https://example.com/" },
      [],
      undefined,
      "fudo-browser-run://session"
    );
    expect(ok.liveViewUrl).toBeUndefined();
  });
});
