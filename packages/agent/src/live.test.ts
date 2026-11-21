import { describe, expect, it } from "vitest";
import { emptyLedger } from "./ledger";
import { emptyRegistries, registerJob } from "./registry";
import { runLiveTurn } from "./turn";

const now = Date.parse("2026-10-15T00:00:00Z");

describe("ライブターン", () => {
  it("ツール結果を見てから最終文を返す", async () => {
    let round = 0;
    const turn = await runLiveTurn({
      ledger: emptyLedger(),
      now,
      userText: "カードを置いて",
      registries: registerJob(emptyRegistries(), "demo.ping"),
      complete: async () => {
        round += 1;
        if (round === 1) {
          return {
            content: null,
            toolCalls: [{
              id: "1",
              type: "function",
              function: { name: "kanban_add", arguments: JSON.stringify({ id: "c1", title: "調査" }) }
            }],
            tokens: 40
          };
        }
        return { content: "置きました。", toolCalls: [], tokens: 12 };
      }
    });
    expect(turn.board.cards.get("c1")?.title).toBe("調査");
    expect(turn.text).toBe("置きました。");
    expect(turn.operation.ok).toBe(true);
    expect(turn.tokensUsed).toBe(52);
  });

  it("日次上限では complete を呼ばない", async () => {
    let calls = 0;
    const turn = await runLiveTurn({
      ledger: emptyLedger(),
      now,
      userText: "続けて",
      tokensToday: 2_000_000,
      complete: async () => {
        calls += 1;
        return { content: "呼ばれない", toolCalls: [], tokens: 9 };
      }
    });
    expect(calls).toBe(0);
    expect(turn.blocked).toBe(true);
    expect(turn.tokensUsed).toBe(0);
    expect(turn.text).toContain("明日");
  });

  it("ツール後に空本文ならテキスト専用リカバリで報告する", async () => {
    let round = 0;
    const turn = await runLiveTurn({
      ledger: emptyLedger(),
      now,
      userText: "カードを置いて",
      registries: registerJob(emptyRegistries(), "demo.ping"),
      complete: async ({ tools }) => {
        round += 1;
        if (round === 1) {
          return {
            content: null,
            toolCalls: [{
              id: "1",
              type: "function",
              function: { name: "kanban_add", arguments: JSON.stringify({ id: "c2", title: "調査" }) }
            }],
            tokens: 10
          };
        }
        if (round === 2) {
          // 通常の最終呼び出し（ツール付き）が空 → リカバリへ
          expect(tools.length).toBeGreaterThan(0);
          return { content: "", toolCalls: [], tokens: 5 };
        }
        expect(tools).toEqual([]);
        return { content: "カードを置きました。続きがあれば指示してください。", toolCalls: [], tokens: 8 };
      }
    });
    expect(turn.board.cards.get("c2")?.title).toBe("調査");
    expect(turn.text).toMatch(/カードを置きました/);
    expect(round).toBe(3);
  });

  it("run_agent はライブ経路で実行先を呼ぶ", async () => {
    let round = 0;
    const turn = await runLiveTurn({
      ledger: emptyLedger(),
      now,
      userText: "Claude に要約させて",
      agentAllow: ["claude-code"],
      agentHost: {
        workspaces: async () => ({ documents: [], repos: [] }),
        run: async () => ({ ok: true, result: "要約OK", exitCode: 0, changes: [] }),
        writeBack: async () => ({ ok: true, summary: "" }),
        discard: async () => undefined
      },
      complete: async () => {
        round += 1;
        if (round === 1) {
          return {
            content: null,
            toolCalls: [
              {
                id: "1",
                type: "function",
                function: {
                  name: "run_agent",
                  arguments: JSON.stringify({
                    agent: "claude-code",
                    prompt: "packages/agent を短く要約して"
                  })
                }
              }
            ],
            tokens: 10
          };
        }
        return { content: "要約しました。", toolCalls: [], tokens: 5 };
      }
    });
    expect(turn.toolLog[0]).toMatchObject({ ok: true, result: "要約OK" });
    expect(turn.text).toBe("要約しました。");
  });

  it("書き戻し待ちの変更が出たらターンを閉じ、承認待ちを残す", async () => {
    let round = 0;
    const turn = await runLiveTurn({
      ledger: emptyLedger(),
      now,
      userText: "賃料表を直させて",
      agentAllow: ["claude-code"],
      agentHost: {
        workspaces: async () => ({ documents: [{ docId: "d1", name: "rent.csv", version: 1 }], repos: [] }),
        run: async () => ({
          ok: true,
          result: "直した",
          exitCode: 0,
          runId: "r1",
          changes: [{ path: "rent.csv", status: "modified", binary: false, diff: "-1\n+2" }]
        }),
        writeBack: async () => ({ ok: true, summary: "" }),
        discard: async () => undefined
      },
      complete: async () => {
        round += 1;
        return {
          content: "Claude Code に直してもらいます。",
          toolCalls: [
            {
              id: "1",
              type: "function",
              function: {
                name: "run_agent",
                arguments: JSON.stringify({
                  agent: "claude-code",
                  prompt: "賃料を 2 に直して",
                  workspace: { kind: "files", docIds: ["d1"] }
                })
              }
            }
          ],
          tokens: 10
        };
      }
    });
    expect(round).toBe(1);
    expect(turn.pendingAgentWrite).toMatchObject({ runId: "r1" });
    expect(turn.ledger.planPending).toBe(true);
    expect(turn.text).toBe("Claude Code に直してもらいます。");
  });

  it("実行先が無ければ run_agent をモデルに見せない", async () => {
    const offered: string[][] = [];
    await runLiveTurn({
      ledger: emptyLedger(),
      now,
      userText: "Claude に要約させて",
      agentAllow: ["claude-code"],
      complete: async ({ tools }) => {
        offered.push((tools ?? []).map((def) => def.function.name));
        return { content: "できません。", toolCalls: [], tokens: 5 };
      }
    });
    expect(offered[0]).not.toContain("run_agent");
    expect(offered[0]).toContain("run_cli");
  });

  it("リカバリも空なら事実ベースのフォールバック文", async () => {
    let round = 0;
    const turn = await runLiveTurn({
      ledger: emptyLedger(),
      now,
      userText: "カードを置いて",
      registries: registerJob(emptyRegistries(), "demo.ping"),
      complete: async () => {
        round += 1;
        if (round === 1) {
          return {
            content: null,
            toolCalls: [{
              id: "1",
              type: "function",
              function: { name: "kanban_add", arguments: JSON.stringify({ id: "c3", title: "調査" }) }
            }],
            tokens: 10
          };
        }
        return { content: "", toolCalls: [], tokens: 3 };
      }
    });
    expect(turn.text).toMatch(/一通り終わりました|一部まで|続きませんでした/);
    expect(turn.text).not.toBe("（応答が空でした）");
  });
});
