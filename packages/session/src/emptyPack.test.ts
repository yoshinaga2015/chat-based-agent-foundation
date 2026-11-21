import { domainPack, type ChatComplete, type ChatToolDef } from "agent";
import { describe, expect, it } from "vitest";
import { dumpSession, loadSession } from "./blob";
import { createSession, draftSpeak, viewOf, writeNote, type Session } from "./session";

function scripted(calls: { name: string; args: unknown }[], reply: string, seen: ChatToolDef[][] = []): ChatComplete {
  let round = 0;
  return async ({ tools }) => {
    seen.push(tools);
    round += 1;
    if (round === 1 && calls.length > 0) {
      return {
        content: null,
        toolCalls: calls.map((call, index) => ({
          id: `c${index}`,
          type: "function" as const,
          function: { name: call.name, arguments: JSON.stringify(call.args) }
        })),
        tokens: 1
      };
    }
    return { content: reply, toolCalls: [], tokens: 1 };
  };
}

function names(tools: ChatToolDef[] | undefined): string[] {
  return (tools ?? []).map((tool) => tool.function.name);
}

describe("ドメインのパックが無い殻", () => {
  it("パックは空で、卓・表示・保存にドメインの欄が出ない", () => {
    expect(domainPack().id).toBe("none");
    const session = createSession();
    expect(session.desk.domain).toBeNull();
    const view = viewOf(session) as Record<string, unknown>;
    for (const key of ["properties", "proforma", "files", "unread", "income"]) expect(view).not.toHaveProperty(key);
    const blob = dumpSession(session);
    expect(blob.files).toEqual([]);
    expect(blob.domain).toBeNull();
    expect(loadSession(blob).desk.domain).toBeNull();
  });

  it("チャット：試算の発話も横取りせずモデルへ渡し、ドメインの道具を見せない", async () => {
    const seen: ChatToolDef[][] = [];
    const draft = await draftSpeak(createSession(), "年次を出して", 1, scripted([], "了解です。", seen));
    expect(draft.tokens.join("")).toBe("了解です。");
    expect(seen).toHaveLength(1);
    const tools = names(seen[0]);
    expect(tools).not.toContain("run_calc");
    expect(tools).not.toContain("compare_rows");
    expect(tools).toEqual(expect.arrayContaining(["web_search", "browser_fetch", "write_records", "kanban_add"]));
    const write = seen[0]!.find((tool) => tool.function.name === "write_records");
    expect(JSON.stringify(write?.function.parameters)).not.toContain("property");
  });

  it("チャット：比較の発話もモデルへ渡す", async () => {
    let calls = 0;
    const draft = await draftSpeak(createSession(), "比較して", 1, async () => {
      calls += 1;
      return { content: "何を比べますか。", toolCalls: [], tokens: 1 };
    });
    expect(calls).toBe(1);
    expect(draft.tokens.join("")).toBe("何を比べますか。");
  });

  it("HITL：ノートの削除は承認待ちになり、スレッドに載る", async () => {
    const seeded: Session = writeNote(createSession(), { id: "n1", title: "下書き", body: "本文" }, 1);
    const draft = await draftSpeak(
      seeded,
      "n1 のノートを消して",
      2,
      scripted([{ name: "write_records", args: { ops: [{ kind: "note", id: "n1", delete: true }] } }], "承認待ちにしました。")
    );
    const view = viewOf(draft.next) as { pendingDelete: { kind: string; id: string } | null; threads: { awaiting: string | null }[] };
    expect(view.pendingDelete).toEqual({ kind: "note", id: "n1" });
    expect(view.threads[0]?.awaiting).toBe("approval");
    expect(draft.next.desk.ledger.notes.get("n1")?.deletedAt ?? null).toBeNull();
  });

  it("ドメインの property 書き込みは受け付けない", async () => {
    const draft = await draftSpeak(
      createSession(),
      "物件の価格を書いて",
      1,
      scripted([{ name: "write_records", args: { ops: [{ kind: "property", id: "p1", fields: { price_yen: 1 } }] } }], "書けませんでした。")
    );
    const result = draft.next.desk.last?.toolLog[0] as { ok: boolean; reason?: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid_value");
  });

  it("ブラウザ使用と MCP の道具はパックと無関係に見える", async () => {
    const seen: ChatToolDef[][] = [];
    await draftSpeak(createSession(), "このページを開いて", 1, scripted([], "開きます。", seen));
    expect(names(seen[0])).toEqual(
      expect.arrayContaining(["browser_navigate", "browser_snapshot", "browser_request_handoff", "mcp_configure"])
    );
    const handoff = seen[0]!.find((tool) => tool.function.name === "browser_request_handoff");
    expect(handoff?.function.description).not.toMatch(/路線価/);
  });
});
