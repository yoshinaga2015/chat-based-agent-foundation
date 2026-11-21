import type { AgentHost, BrowserSession, ChatComplete } from "agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dumpSession, loadSession } from "./blob";
import { createSession, createThread, draftSpeak, resolvePlan, viewOf, type Session } from "./session";
import { currentBrowserHandoff } from "./threadHitl";

const runner: AgentHost = {
  workspaces: async () => ({ documents: [{ docId: "d1", name: "README.md", version: 1 }], repos: [] }),
  run: async (request) => ({
    ok: true,
    result: request.prompt,
    exitCode: 0,
    runId: `run-${request.prompt}`,
    changes: [{ path: "README.md", status: "modified", binary: false, diff: "-a\n+b" }]
  }),
  writeBack: async () => ({ ok: true, summary: "書き戻した" }),
  discard: async () => undefined
};

function callOnce(name: string, args: unknown, reply: string): ChatComplete {
  let round = 0;
  return async () => {
    round += 1;
    if (round === 1) {
      return {
        content: null,
        toolCalls: [{ id: `c-${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
        tokens: 1
      };
    }
    return { content: reply, toolCalls: [], tokens: 1 };
  };
}

async function askWrite(session: Session, prompt: string, now: number) {
  return draftSpeak(
    session,
    `Claude Code で ${prompt}`,
    now,
    callOnce("run_agent", { agent: "claude-code", prompt, workspace: { kind: "files", docIds: ["d1"] } }, "承認待ちにした。"),
    [],
    {},
    { agentHost: runner }
  );
}

type View = {
  activeThreadId: string | null;
  planPending: boolean;
  pendingAgentWrite: { result: string } | null;
  threads: { id: string; awaiting: "approval" | "handoff" | null }[];
};

describe("承認待ちはスレッド単位", () => {
  const saved = process.env.FUDO_AGENT_ALLOW;
  beforeEach(() => {
    process.env.FUDO_AGENT_ALLOW = "claude-code";
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.FUDO_AGENT_ALLOW;
    else process.env.FUDO_AGENT_ALLOW = saved;
  });

  it("別スレッドの放置された承認は、新しいスレッドの承認依頼を塞がない", async () => {
    const a = (await askWrite(createThread(createSession(), 1), "README を直して", 2)).next;
    const threadA = a.activeThreadId!;
    const b0 = createThread(a, 3);
    const threadB = b0.activeThreadId!;
    expect(threadB).not.toBe(threadA);

    const b = await askWrite(b0, "CHANGELOG を足して", 4);
    const failed = b.next.threads
      .find((thread) => thread.id === threadB)
      ?.lines.flatMap((line) => line.ui ?? [])
      .some((part) => JSON.stringify(part).includes("別の承認待ち"));
    expect(failed).toBe(false);

    const next = b.next;
    expect(next.desk.ledger.planPending).toBe(false);
    expect(next.threads.find((thread) => thread.id === threadA)?.hitl?.pendingAgentWrite?.result).toBe("README を直して");
    expect(next.threads.find((thread) => thread.id === threadB)?.hitl?.pendingAgentWrite?.result).toBe("CHANGELOG を足して");

    const view = viewOf(next) as View;
    expect(view.activeThreadId).toBe(threadB);
    expect(view.pendingAgentWrite?.result).toBe("CHANGELOG を足して");
    expect(view.threads.find((thread) => thread.id === threadA)?.awaiting).toBe("approval");
    expect(view.threads.find((thread) => thread.id === threadB)?.awaiting).toBe("approval");
  });

  it("却下は指定スレッドだけを解き、表示中スレッドは変えない", async () => {
    const a = (await askWrite(createThread(createSession(), 1), "README を直して", 2)).next;
    const threadA = a.activeThreadId!;
    const b = (await askWrite(createThread(a, 3), "CHANGELOG を足して", 4)).next;
    const threadB = b.activeThreadId!;

    const resolved = await resolvePlan(b, "reject", 5, { threadId: threadA, agentHost: runner });
    expect(resolved.activeThreadId).toBe(threadB);
    expect(resolved.threads.find((thread) => thread.id === threadA)?.hitl ?? null).toBeNull();
    expect(resolved.threads.find((thread) => thread.id === threadB)?.hitl?.pendingAgentWrite?.result).toBe("CHANGELOG を足して");
    expect(resolved.threads.find((thread) => thread.id === threadA)?.lines.at(-1)?.role).toBe("assistant");
    expect(resolved.threads.find((thread) => thread.id === threadB)?.lines.at(-1)?.text).toBe("CHANGELOG を足して");
  });

  it("保存して読み戻してもスレッドごとの承認待ちが残る", async () => {
    const a = (await askWrite(createThread(createSession(), 1), "README を直して", 2)).next;
    const loaded = loadSession(dumpSession(a));
    expect(loaded.threads.find((thread) => thread.id === a.activeThreadId)?.hitl?.pendingAgentWrite?.result).toBe("README を直して");
    expect(loaded.desk.ledger.planPending).toBe(false);
  });

  it("旧 blob の desk 1枠の承認待ちは、保存時の表示中スレッドへ移る", () => {
    const blob = {
      version: 1,
      activeThreadId: "t2",
      threads: [
        { id: "t1", title: "一", titleLocked: false, updatedAt: 1, lines: [] },
        { id: "t2", title: "二", titleLocked: false, updatedAt: 2, lines: [] }
      ],
      undo: [],
      ownedIds: [] as string[],
      notes: [],
      cards: [],
      skills: {},
      workflows: [],
      ran: [],
      files: [],
      planPending: true,
      pendingPlan: "Claude Code に書き込み依頼（要承認）",
      pendingAgentWrite: {
        runId: "r1",
        agent: "claude-code",
        label: "x",
        result: "直して",
        workspace: { kind: "files", docIds: ["d1"] },
        changes: [{ path: "a.md", status: "modified", binary: false }]
      }
    };
    const loaded = loadSession(blob as never);
    expect(loaded.desk.ledger.planPending).toBe(false);
    expect(loaded.threads.find((thread) => thread.id === "t1")?.hitl ?? null).toBeNull();
    expect(loaded.threads.find((thread) => thread.id === "t2")?.hitl?.pendingAgentWrite?.result).toBe("直して");
  });
});

describe("ブラウザ引き継ぎはスレッド単位", () => {
  function mockBrowser(): BrowserSession {
    return {
      navigate: vi.fn(async (url: string) => ({ url, title: "T", text: "x", truncated: false })),
      snapshot: vi.fn(async () => ({ url: "https://example.com/", title: "T", text: "x", truncated: false })),
      click: vi.fn(async () => ({ url: "https://example.com/", title: "T" })),
      type: vi.fn(async () => ({ url: "https://example.com/", title: "T" })),
      scroll: vi.fn(async () => ({ url: "https://example.com/", title: "T" })),
      select: vi.fn(async () => ({ url: "https://example.com/", title: "T" })),
      insertText: vi.fn(async () => undefined),
      screenshot: vi.fn(async () => null),
      liveViewUrl: vi.fn(() => null),
      refreshLiveViewUrl: vi.fn(async () => null),
      detachForHandoff: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined)
    } as BrowserSession;
  }

  it("別スレッドが引き継ぎ中なら操作せず、共有ブラウザも閉じない", async () => {
    const base = createThread(createSession(), 1);
    const threadA = base.activeThreadId!;
    const handoff = {
      reason: "login" as const,
      task: "ログインしたら完了を押す。",
      liveViewUrl: "https://example.com/live",
      createdAt: 1,
      expiresAt: 1 + 15 * 60_000
    };
    const held: Session = {
      ...base,
      threads: base.threads.map((thread) => (thread.id === threadA ? { ...thread, browserHandoff: handoff } : thread))
    };
    const b0 = createThread({ ...held, threads: held.threads.map((t) => ({ ...t, lines: [{ role: "user" as const, text: "開いて" }] })) }, 2);
    const threadB = b0.activeThreadId!;
    expect(threadB).not.toBe(threadA);

    const browser = mockBrowser();
    const labels: string[] = [];
    const drafted = await draftSpeak(
      b0,
      "example.com を開いて",
      3,
      callOnce("browser_navigate", { url: "https://example.com/" }, "別スレッドで引き継ぎ中。"),
      [],
      {},
      {
        browserSession: browser,
        onTool: (event) => {
          if (event.status !== "running") labels.push(event.label);
        }
      }
    );

    expect(labels).toEqual(["ブラウザは別スレッドで引き継ぎ中"]);
    expect(browser.navigate).not.toHaveBeenCalled();
    expect(browser.close).not.toHaveBeenCalled();
    expect(drafted.next.threads.find((thread) => thread.id === threadA)?.browserHandoff).toEqual(handoff);
    expect(drafted.next.threads.find((thread) => thread.id === threadB)?.browserHandoff ?? null).toBeNull();
    expect(currentBrowserHandoff(drafted.next)).toEqual(handoff);
    expect((viewOf(drafted.next) as { pendingBrowserHandoff: unknown }).pendingBrowserHandoff).toBeNull();
  });
});
