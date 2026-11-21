import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createProductServer } from "./http";
import { addCard, advanceClock, chunks, createSession, createThread, draftSkill, draftSpeak, enableFlow, resolvePlan, saveFlow, selectThread, startJob, viewOf, writeMemo, writeNote } from "./session";

describe("製品の発話", () => {











  it("2万字を超える発話は拒む", async () => {
    const draft = await draftSpeak(createSession(), "あ".repeat(20_001), 1, null);
    expect(draft.rejected).toBe("too_long");
  });


  it("モデル完了関数があればツールを回して答える", async () => {
    let round = 0;
    const draft = await draftSpeak(createSession(), "カードを1枚置いて", 1, async () => {
      round += 1;
      if (round === 1) {
        return {
          content: null,
          toolCalls: [{
            id: "c1",
            type: "function",
            function: { name: "kanban_add", arguments: JSON.stringify({ id: "card-live", title: "調査" }) }
          }],
          tokens: 30
        };
      }
      return { content: "カード「調査」を未着手に置きました。", toolCalls: [], tokens: 18 };
    });
    expect(draft.tokens.join("")).toContain("調査");
    expect(draft.next.desk.board.cards.get("card-live")?.title).toBe("調査");
    expect(draft.tokensUsed).toBe(48);
  });

  it("日次上限では LLM を呼ばず案内を返す", async () => {
    let calls = 0;
    const draft = await draftSpeak(createSession(), "こんにちは", 1, async () => {
      calls += 1;
      return { content: "呼ばれない", toolCalls: [], tokens: 1 };
    }, [], { tokensToday: 100, tokenCap: 100 });
    expect(calls).toBe(0);
    expect(draft.tokensUsed).toBe(0);
    expect(draft.tokens.join("")).toContain("明日");
  });
});

describe("エージェント基盤", () => {
  it("スキルを保存し、読んで: で本文を返す", async () => {
    const saved = draftSkill(createSession(), {
      name: "手順",
      description: "確認用",
      body: "まず台帳を読む",
      material: "utterance"
    }, 1);
    expect(Object.keys(saved.desk.skills)).toContain("手順");
    const draft = await draftSpeak(saved, "読んで:手順", 2, null);
    expect(draft.tokens.join("")).toContain("まず台帳を読む");
  });

  it("カードを置き、時計で有効なワークフローだけが起きる", () => {
    let session = addCard(createSession(), "調べる", 1);
    expect([...session.desk.board.cards.values()][0]?.title).toBe("調べる");
    const fireAt = Date.UTC(2026, 9, 15, 0, 0, 0);
    session = saveFlow(session, {
      name: "毎日投稿",
      id: "毎日投稿",
      schedule: { kind: "daily" },
      steps: [{ type: "thread_post", id: "post", text: "起きた" }]
    }, fireAt - 1);
    session = enableFlow(session, "毎日投稿", true);
    session = advanceClock(session, fireAt);
    expect(session.desk.posts.at(-1)).toBe("起きた");
  });

  it("実行計画の承認待ちでは書けず、承認後にノートを書ける", async () => {
    // 製品の productJev を避けるため desk 直呼び相当: proposePlan は環境依存なので down/true 前提の経路を desk 経由で固定しない。
    // ここでは sync の承認待ちを deskProposePlan 相当の結果で再現する。
    const { deskProposePlan } = await import("agent");
    let session = createSession();
    session = {
      ...session,
      desk: deskProposePlan(session.desk, "台帳を読んでから書く", 1, () => true)
    };
    const pending = viewOf(session) as { planPending: boolean; pendingPlan: string | null };
    expect(pending.planPending).toBe(true);
    expect(pending.pendingPlan).toBe("台帳を読んでから書く");
    session = writeNote(session, { id: "n1", title: "甲", body: "本文" }, 2);
    expect(session.desk.ledger.notes.get("n1")?.title).not.toBe("甲");
    expect(session.desk.notice).toContain("plan_pending");
    session = await resolvePlan(session, "approve", 3);
    expect(session.desk.ledger.planPending).toBe(false);
    session = writeNote(session, { id: "n1", title: "甲", body: "本文" }, 4);
    expect(session.desk.ledger.notes.get("n1")?.title).toBe("甲");
  });

  it("メモと demo.ping ジョブが製品経路で動く", () => {
    let session = writeMemo(createSession(), { id: "m1", body: "覚えておく" }, 1);
    expect(session.desk.ledger.memos.get("m1")?.body).toBe("覚えておく");
    session = startJob(session, "demo.ping", 2);
    expect(session.desk.ran).toContain("demo.ping");
    const fireAt = Date.UTC(2026, 9, 16, 0, 0, 0);
    session = saveFlow(session, {
      name: "毎朝ping",
      id: "毎朝ping",
      schedule: { kind: "daily" },
      steps: [{ type: "start_job", id: "job", name: "demo.ping" }]
    }, fireAt - 1);
    session = enableFlow(session, "毎朝ping", true);
    session = advanceClock(session, fireAt);
    expect(session.desk.ran).toContain("毎朝ping");
  });
});

describe("日次トークン上限", () => {
  it("FUDO_DAILY_TOKEN_CAP=0 では LLM なしで上限案内を返す", async () => {
    const prev = process.env.FUDO_DAILY_TOKEN_CAP;
    process.env.FUDO_DAILY_TOKEN_CAP = "0";
    const { server } = createProductServer(new Uint8Array(), 5);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    try {
      const session = await (await fetch(`http://127.0.0.1:${port}/api/session`)).json() as {
        tokenCapReached: boolean;
        tokenCap: number;
      };
      expect(session.tokenCap).toBe(0);
      expect(session.tokenCapReached).toBe(true);
      const speak = await (await fetch(`http://127.0.0.1:${port}/api/speak`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "こんにちは" })
      })).text();
      expect(speak).toContain("本日の利用上限");
      expect(speak).toContain("\"tokenCapReached\":true");
    } finally {
      if (prev === undefined) delete process.env.FUDO_DAILY_TOKEN_CAP;
      else process.env.FUDO_DAILY_TOKEN_CAP = prev;
      server.close();
    }
  });
});

describe("SSE", () => {
  it("考えていますのあとで、後から来た発話が先の応答を捨てる", async () => {
    const { server } = createProductServer(new Uint8Array(), 50);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    await fetch(`http://127.0.0.1:${port}/api/sample`, { method: "POST" });
    const first = fetch(`http://127.0.0.1:${port}/api/speak`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "こんにちは" })
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await fetch(`http://127.0.0.1:${port}/api/speak`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "こんにちは" })
    });
    const firstText = await (await first).text();
    const secondText = await second.text();
    expect(firstText).toContain("考えています…");
    expect(firstText).toContain("\"interrupted\":true");
    expect(secondText).toContain("考えています…");
    expect(secondText).toContain("\"interrupted\":false");
    expect(secondText).toContain("バインディング");
    expect(chunks("あいう")).toEqual(["あいう"]);
    server.close();
  });

  it("SSE を切っても run は続き、stream 再接続で完了を受け取れる", async () => {
    const { server } = createProductServer(new Uint8Array(), 80);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    await fetch(`http://127.0.0.1:${port}/api/sample`, { method: "POST" });
    const abort = new AbortController();
    const started = fetch(`http://127.0.0.1:${port}/api/speak`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "こんにちは" }),
      signal: abort.signal
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const session = await (await fetch(`http://127.0.0.1:${port}/api/session`)).json() as {
      activeSpeak: { runId: string; threadId: string | null } | null;
    };
    expect(session.activeSpeak?.runId).toBeTruthy();
    abort.abort();
    await started.catch(() => undefined);
    const resumed = await (await fetch(
      `http://127.0.0.1:${port}/api/speak/stream?runId=${encodeURIComponent(session.activeSpeak!.runId)}`
    )).text();
    expect(resumed).toContain("考えています…");
    expect(resumed).toContain("\"interrupted\":false");
    expect(resumed).toContain("バインディング");
    const after = await (await fetch(`http://127.0.0.1:${port}/api/session`)).json() as {
      activeSpeak: unknown;
    };
    expect(after.activeSpeak).toBeNull();
    server.close();
  });
});

describe("会話スレッド", () => {
  it("空の新規会話があるときは追加せず、発話後は別スレッドを作れる", () => {
    const first = createThread(createSession(), 1);
    expect(first.threads).toHaveLength(1);
    expect(createThread(first, 2).threads).toHaveLength(1);
    const spoken = { ...first, threads: first.threads.map((thread) => ({ ...thread, lines: [{ role: "user" as const, text: "hi" }] })) };
    const second = createThread(spoken, 3);
    expect(second.threads).toHaveLength(2);
    expect(second.activeThreadId).toBe(second.threads[1]?.id);
    expect(selectThread(second, second.threads[0]!.id).activeThreadId).toBe(second.threads[0]!.id);
  });
});
