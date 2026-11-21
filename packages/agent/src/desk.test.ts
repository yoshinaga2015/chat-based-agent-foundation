import { describe, expect, it } from "vitest";
import { createDesk, deskAdvance, deskAllowSend, deskDeleteNote, deskDraftSkill, deskEnable, deskInterrupt, deskMailPreview, deskMailSend, deskMailSource, deskMoveCard, deskResolvePlan, deskSaveWorkflow, deskAddCard, deskSpeak, deskWriteNote, snapshot } from "./desk";
import { runTurn } from "./turn";

const now = Date.parse("2026-10-15T00:00:00Z");

describe("評価卓", () => {
  it("フォームと同じ関数でスキルを作り、同じターンの回答に未確認が付く", () => {
    const desk = deskDraftSkill(createDesk(), {
      name: "tactic",
      description: "観点",
      body: "内訳は12,345円",
      material: "utterance"
    }, now);
    expect(desk.skills.tactic?.body).toBe("内訳は12,345円");
    expect(desk.last?.text).toContain("12,345円");
    expect(desk.last?.unconfirmed.map((token) => token.value)).toContain(12345);
  });

  it("不正な状態はカードを動かさない", () => {
    const added = deskAddCard(createDesk(), "指値", now);
    const moved = deskMoveCard(added, "card-1", "着手中", now);
    expect(moved.notice).toBe("状態は未着手、実行中、確認待ち、完了");
    expect(moved.board.cards.get("card-1")?.state).toBe("未着手");
  });

  it("旧ラベル準備済みは実行中へ正規化する", () => {
    const added = deskAddCard(createDesk(), "指値", now);
    const moved = deskMoveCard(added, "card-1", "準備済み", now);
    expect(moved.board.cards.get("card-1")?.state).toBe("実行中");
    expect(moved.notice).toBeNull();
  });

  it("有効にしたワークフローだけが午前9時に起きる", () => {
    const saved = deskSaveWorkflow(createDesk(), {
      name: "毎日",
      id: "daily",
      schedule: { kind: "daily" },
      steps: [{ type: "thread_post", id: "post", text: "起きた" }]
    }, now - 1);
    const off = deskAdvance(saved, now);
    expect(off.ran).toEqual([]);
    const on = deskAdvance(deskEnable(saved, "daily", true), now);
    expect(on.ran).toEqual(["daily"]);
    expect(on.posts).toEqual(["起きた"]);
  });

  it("送信段はテンプレートが無いので保存できない", () => {
    const desk = deskSaveWorkflow(createDesk(), {
      name: "送信",
      steps: [{ type: "send", id: "send", templateId: "offer", preview: "全文", button: true }]
    });
    expect(desk.notice).toBe("send_blocked");
    expect(desk.workflows).toHaveLength(0);
  });




  it("送って、は確認カードを開くだけで記録しない", () => {
    const sourced = deskMailSource(createDesk(), { id: "flyer-1", propertyId: "p1", text: "担当 seller@example.com" });
    const opened = deskMailPreview(sourced, {
      kind: "purchase-offer",
      propertyId: "p1",
      propertyName: "北の戸建",
      location: "札幌市北区",
      offerYen: 18_000_000,
      purpose: "",
      senderName: "山田",
      senderContact: "buyer@example.com",
      note: "",
      address: "seller@example.com"
    });
    const spoken = deskSpeak(opened, "送っておいて", now);
    expect(spoken.sends).toHaveLength(0);
    expect(spoken.mailCardOpen).toBe(true);
    expect(spoken.notice).toContain("ボタン");
    const blocked = deskMailSend(spoken, now);
    expect(blocked.sends).toHaveLength(0);
    expect(blocked.notice).toBe("send_blocked");
    const sent = deskMailSend(deskAllowSend(spoken, true), now);
    expect(sent.sends).toHaveLength(1);
    expect(sent.posts[0]).not.toContain("18000000");
    const view = snapshot(sent) as { sends: { audit: string }[] };
    expect(view.sends[0]?.audit).not.toContain("提示価格");
  });


  it("割り込みはカードを残さない", () => {
    const desk = deskInterrupt(createDesk(), now);
    expect(desk.board.cards.has("interrupted-card")).toBe(false);
    expect(desk.last?.operation.reason).toBe("interrupted");
  });

  it("チャットの削除は HITL 承認後にだけ確定し、画面の取り消しは即時", async () => {
    const written = deskWriteNote(createDesk(), { id: "n1", title: "甲", body: "本文" }, now);
    const turn = runTurn({
      ledger: written.ledger,
      board: written.board,
      now: now + 1,
      userText: "消して",
      steps: [{ calls: [{ name: "write_records", args: { ops: [{ kind: "note", id: "n1", delete: true }] } }] }]
    });
    const pending = {
      ...written,
      ledger: turn.ledger,
      pendingPlan: turn.pendingPlan,
      pendingDelete: turn.pendingDelete
    };
    expect(pending.ledger.notes.get("n1")?.deletedAt).toBeNull();
    expect(pending.ledger.planPending).toBe(true);
    const approved = await deskResolvePlan(pending, "approve", now + 2);
    expect(approved.ledger.notes.get("n1")?.deletedAt).toBe(now + 2);
    expect(approved.ledger.planPending).toBe(false);
    expect(approved.pendingDelete).toBeNull();
    expect(approved.notice).toBe("削除しました");

    const again = deskWriteNote(createDesk(), { id: "n2", title: "乙", body: "本文" }, now);
    const ui = deskDeleteNote(again, "n2", now + 3);
    expect(ui.ledger.notes.get("n2")?.deletedAt).toBe(now + 3);
    expect(ui.ledger.planPending).toBe(false);
  });

  it("チャットのカード削除も HITL 承認後にだけ確定する", async () => {
    const added = deskAddCard(createDesk(), "指値", now);
    const turn = runTurn({
      ledger: added.ledger,
      board: added.board,
      now: now + 1,
      userText: "カードを消して",
      steps: [{ calls: [{ name: "kanban_update", args: { id: "card-1", delete: true } }] }]
    });
    const pending = {
      ...added,
      ledger: turn.ledger,
      board: turn.board,
      pendingPlan: turn.pendingPlan,
      pendingDelete: turn.pendingDelete
    };
    expect(pending.board.cards.get("card-1")?.deletedAt).toBeNull();
    expect(pending.pendingDelete).toEqual({ kind: "card", id: "card-1" });
    const approved = await deskResolvePlan(pending, "approve", now + 2);
    expect(approved.board.cards.get("card-1")?.deletedAt).toBe(now + 2);
  });

  it("ワークフローとスキルの削除も HITL 承認後にだけ確定する", async () => {
    const withFlow = deskSaveWorkflow(createDesk(), {
      name: "毎日",
      id: "daily",
      schedule: { kind: "daily" },
      steps: [{ type: "thread_post", id: "post", text: "起きた" }]
    }, now - 1);
    const withSkill = deskDraftSkill(withFlow, {
      name: "tactic",
      description: "観点",
      body: "内訳は確認する",
      material: "utterance"
    }, now);
    const flowTurn = runTurn({
      ...turnLike(withSkill, now + 1),
      userText: "自動化を消して",
      steps: [{ calls: [{ name: "delete_item", args: { kind: "workflow", id: "daily" } }] }]
    });
    expect(flowTurn.pendingDelete).toEqual({ kind: "workflow", id: "daily" });
    expect(withSkill.workflows).toHaveLength(1);
    const flowGone = await deskResolvePlan({
      ...withSkill,
      ledger: flowTurn.ledger,
      pendingPlan: flowTurn.pendingPlan,
      pendingDelete: flowTurn.pendingDelete
    }, "approve", now + 2);
    expect(flowGone.workflows).toHaveLength(0);

    const skillTurn = runTurn({
      ...turnLike(flowGone, now + 3),
      userText: "スキルを消して",
      steps: [{ calls: [{ name: "delete_item", args: { kind: "skill", id: "tactic" } }] }]
    });
    const skillGone = await deskResolvePlan({
      ...flowGone,
      ledger: skillTurn.ledger,
      pendingPlan: skillTurn.pendingPlan,
      pendingDelete: skillTurn.pendingDelete
    }, "approve", now + 4);
    expect(skillGone.skills.tactic).toBeUndefined();
  });
});

function turnLike(desk: ReturnType<typeof createDesk>, now: number) {
  return {
    ledger: desk.ledger,
    board: desk.board,
    userSkills: desk.skills,
    workflows: desk.workflows,
    now
  };
}
