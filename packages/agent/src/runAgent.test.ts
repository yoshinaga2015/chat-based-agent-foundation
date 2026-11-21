import { describe, expect, it, vi } from "vitest";
import {
  claudePrintArgv,
  parseAgentRunArgs,
  parseClaudePrintStdout,
  resolvePendingAgentWrite,
  runAgentTool,
  truncateAgentText,
  type AgentHost,
  type AgentRunResult,
  type PendingAgentWrite
} from "./runAgent";
import { runAgentToolDef } from "./toolDefs";

function host(result: AgentRunResult, extra: Partial<AgentHost> = {}): AgentHost {
  return {
    workspaces: async () => ({ documents: [], repos: [] }),
    run: async () => result,
    writeBack: async () => ({ ok: true, summary: "書き戻した" }),
    discard: async () => undefined,
    ...extra
  };
}

function freshState(agentHost?: AgentHost) {
  return {
    agentAllow: ["claude-code"],
    ...(agentHost ? { agentHost } : {}),
    planPending: false,
    planText: null,
    pendingDelete: null,
    pendingMcp: null,
    pendingAgentWrite: null
  };
}

function freshDraft() {
  return {
    planText: null as string | null,
    pendingAgentWrite: null as PendingAgentWrite | null,
    ledger: { planPending: false }
  };
}

describe("parseAgentRunArgs", () => {
  it("workspace 省略は作業場所なし", () => {
    const parsed = parseAgentRunArgs({ agent: "claude-code", prompt: "このリポジトリを要約して" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.request.workspace).toEqual({ kind: "none" });
  });

  it("files は docIds を重複なしで取る", () => {
    const parsed = parseAgentRunArgs({
      agent: "claude-code",
      prompt: "表を直して",
      workspace: { kind: "files", docIds: ["d1", "d1", " d2 "] }
    });
    expect(parsed.ok && parsed.request.workspace).toEqual({ kind: "files", docIds: ["d1", "d2"] });
  });

  it("repo は owner/name 以外と .. を含む ref を拒否", () => {
    expect(parseAgentRunArgs({ agent: "claude-code", prompt: "直して", workspace: { kind: "repo", repo: "nope" } }).ok).toBe(false);
    expect(
      parseAgentRunArgs({ agent: "claude-code", prompt: "直して", workspace: { kind: "repo", repo: "a/b", ref: "../x" } }).ok
    ).toBe(false);
  });

  it("未知 agent は拒否", () => {
    expect(parseAgentRunArgs({ agent: "nope", prompt: "hello world" }).ok).toBe(false);
  });
});

describe("claudePrintArgv", () => {
  it("--bare で API キーだけを認証に使い、予算上限を付ける", () => {
    const argv = claudePrintArgv(
      { agent: "claude-code", prompt: "-x 要約", workspace: { kind: "files", docIds: ["d1"] }, timeoutMs: 60_000 },
      2
    );
    expect(argv.slice(0, 3)).toEqual(["claude", "--bare", "--print"]);
    expect(argv).toContain("--no-session-persistence");
    expect(argv[argv.indexOf("--max-budget-usd") + 1]).toBe("2");
    expect(argv.at(-2)).toBe("--");
    expect(argv.at(-1)).toMatch(/^-x 要約\n\n（作業場所: \/workspace。/);
  });

  it("作業場所なしは読み取りのみの制約を足す", () => {
    const argv = claudePrintArgv({ agent: "claude-code", prompt: "要約", workspace: { kind: "none" }, timeoutMs: 60_000 }, 1);
    expect(argv.at(-1)).toMatch(/読み取りと説明のみ/);
  });
});

describe("parseClaudePrintStdout", () => {
  it("total_cost_usd を取る", () => {
    expect(
      parseClaudePrintStdout(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "完了です", total_cost_usd: 0.01 }))
    ).toEqual({ ok: true, result: "完了です", costUsd: 0.01 });
  });

  it("is_error は失敗として subtype を理由にする", () => {
    expect(
      parseClaudePrintStdout(JSON.stringify({ type: "result", subtype: "error_max_budget_usd", is_error: true, result: "" }))
    ).toMatchObject({ ok: false, reason: "error_max_budget_usd" });
  });

  it("JSON でなければ失敗", () => {
    expect(parseClaudePrintStdout("Invalid API key")).toMatchObject({ ok: false, reason: "unparsable_output" });
  });
});

describe("runAgentTool", () => {
  it("実行先が無ければ agent_unavailable", async () => {
    const draft = freshDraft();
    const result = await runAgentTool(freshState(), draft, { agent: "claude-code", prompt: "調査して" });
    expect(result).toMatchObject({ ok: false, reason: "agent_unavailable" });
    expect(draft.pendingAgentWrite).toBeNull();
  });

  it("作業場所ありで変更が出たら、書き戻しを承認待ちにする", async () => {
    const draft = freshDraft();
    const result = await runAgentTool(
      freshState(
        host({
          ok: true,
          result: "賃料を直した",
          exitCode: 0,
          runId: "r1",
          changes: [{ path: "rent.csv", status: "modified", binary: false, diff: "-1\n+2" }]
        })
      ),
      draft,
      { agent: "claude-code", prompt: "賃料を直して", workspace: { kind: "files", docIds: ["d1"] } }
    );
    expect(result).toMatchObject({ ok: true, plan_pending: true, changes: [{ path: "rent.csv", status: "modified" }] });
    expect(draft.pendingAgentWrite).toMatchObject({ runId: "r1", workspace: { kind: "files", docIds: ["d1"] } });
    expect(draft.pendingAgentWrite?.changes[0]?.diff).toBe("-1\n+2");
    expect(draft.planText).toMatch(/書類 1件 に書き戻す/);
    expect(draft.ledger.planPending).toBe(true);
  });

  it("変更が無ければ最終文だけ返し、承認は要らない", async () => {
    const draft = freshDraft();
    const result = await runAgentTool(
      freshState(host({ ok: true, result: "要約結果", exitCode: 0, changes: [] })),
      draft,
      { agent: "claude-code", prompt: "要約してほしい", workspace: { kind: "repo", repo: "a/b" } }
    );
    expect(result).toMatchObject({ ok: true, result: "要約結果", exitCode: 0, changes: [] });
    expect(draft.pendingAgentWrite).toBeNull();
  });

  it("別の承認待ちがあれば走らせない", async () => {
    const run = vi.fn(async () => ({ ok: true as const, result: "x", exitCode: 0, changes: [] }));
    const result = await runAgentTool(
      { ...freshState(host({ ok: true, result: "", exitCode: 0, changes: [] }, { run })), planPending: true },
      freshDraft(),
      { agent: "claude-code", prompt: "要約してほしい" }
    );
    expect(result).toMatchObject({ ok: false, reason: "plan_pending" });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("resolvePendingAgentWrite", () => {
  const pending: PendingAgentWrite = {
    runId: "r1",
    agent: "claude-code",
    workspace: { kind: "files", docIds: ["d1"] },
    changes: [{ path: "a.csv", status: "modified", binary: false }],
    result: "",
    label: "x"
  };

  it("却下は複製を捨て、書き戻さない", async () => {
    const discard = vi.fn(async () => undefined);
    const writeBack = vi.fn(async () => ({ ok: true as const, summary: "" }));
    const resolved = await resolvePendingAgentWrite(pending, "reject", host({ ok: false, reason: "x" }, { discard, writeBack }));
    expect(resolved.ok).toBe(true);
    expect(discard).toHaveBeenCalledWith("r1");
    expect(writeBack).not.toHaveBeenCalled();
  });

  it("承認の失敗は理由を返す", async () => {
    const resolved = await resolvePendingAgentWrite(
      pending,
      "approve",
      host({ ok: false, reason: "x" }, { writeBack: async () => ({ ok: false, reason: "staging_expired", detail: { constraint: "複製の保管期限切れ" } }) })
    );
    expect(resolved).toEqual({ ok: false, notice: "書き戻しに失敗した（複製の保管期限切れ）" });
  });
});

describe("runAgentToolDef", () => {
  it("選べない kind を出さない", () => {
    const def = runAgentToolDef({ documents: [], repos: [] });
    const workspace = (def.function.parameters.properties as Record<string, { properties: Record<string, { enum?: string[] }> }>).workspace!;
    expect(workspace.properties.kind!.enum).toEqual(["none"]);
    expect(workspace.properties.docIds).toBeUndefined();
  });

  it("書類とリポジトリを enum に絞る", () => {
    const def = runAgentToolDef({ documents: [{ docId: "d1", name: "rent.xlsx", version: 2 }], repos: ["o/r"] });
    const workspace = (def.function.parameters.properties as Record<string, { properties: Record<string, { enum?: string[]; items?: { enum: string[] } }> }>).workspace!;
    expect(workspace.properties.kind!.enum).toEqual(["none", "files", "repo"]);
    expect(workspace.properties.docIds!.items!.enum).toEqual(["d1"]);
    expect(workspace.properties.repo!.enum).toEqual(["o/r"]);
  });
});

describe("truncateAgentText", () => {
  it("長い文を切る", () => {
    const cut = truncateAgentText("あ".repeat(20), 10);
    expect(cut.truncated).toBe(true);
    expect(cut.text.length).toBe(10);
  });
});
