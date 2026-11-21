import { describe, expect, it } from "vitest";
import { monthlyFireUtc, saveSchedule } from "./clock";
import { applyCardChange, bodyHasNumber, sourceValues } from "./kanban";
import { emptyLedger, insertNote } from "./ledger";
import { TOKEN_CAP_MESSAGE } from "./limits";
import { emptyRegistries, listTools, registerCalc } from "./registry";
import { runCode } from "./sandbox";
import { smokeSkillShelf } from "./bundledSkills";
import { saveUserSkill } from "./skills";
import { runTurn } from "./turn";
import { fireDue, runWorkflow, saveWorkflow, type FlowWorld } from "./workflow";

const now = Date.parse("2026-10-15T00:00:00Z");

function world(ledger = emptyLedger(), extra: Partial<FlowWorld> = {}): FlowWorld {
  return {
    ledger,
    board: { cards: new Map() },
    now,
    posts: [],
    search: () => [],
    commentary: () => "所見だけ",
    calcs: new Map(),
    jobs: new Map(),
    capHit: false,
    ...extra
  };
}

describe("同じターンで作ったスキルを読め、本文の数値は未確認", () => {
  it("保存した直後に読み、文は残して未確認を付ける", () => {
    const turn = runTurn({
      ledger: emptyLedger(),
      now,
      userText: "読んで",
      steps: [
        { calls: [{ name: "save_skill", args: { name: "tactic", description: "観点", body: "内訳は12,345円", material: "utterance" } }] },
        { calls: [{ name: "activate_skill", args: { name: "tactic" } }, { name: "read_skill_resource", args: { name: "tactic" } }] },
        { text: "内訳は12,345円です。" }
      ]
    });
    expect(turn.skills.tactic?.body).toBe("内訳は12,345円");
    expect(turn.toolLog[1]).toMatchObject({ ok: true, name: "tactic" });
    expect(turn.toolLog[2]).toMatchObject({ ok: true, body: "内訳は12,345円" });
    expect(turn.text).toContain("12,345円です。");
    expect(turn.unconfirmed.map((token) => token.value)).toContain(12345);
  });

  it("activate_skill だけで本文が渡り、数値は未確認になる", () => {
    const turn = runTurn({
      ledger: emptyLedger(),
      now,
      userText: "読んで",
      steps: [
        { calls: [{ name: "save_skill", args: { name: "tactic", description: "観点", body: "内訳は12,345円", material: "utterance" } }] },
        { calls: [{ name: "activate_skill", args: { name: "tactic" } }] },
        { text: "内訳は12,345円です。" }
      ]
    });
    expect(turn.toolLog[1]).toMatchObject({
      ok: true,
      name: "tactic",
      description: "観点",
      body: "内訳は12,345円",
      instructions: "内訳は12,345円"
    });
    expect(turn.unconfirmed.map((token) => token.value)).toContain(12345);
  });

  it("既存スキルを save_skill で上書きでき、同梱の参照も write できる", () => {
    const turn = runTurn({
      ledger: emptyLedger(),
      now,
      userText: "スキルを直して",
      skills: smokeSkillShelf(),
      steps: [
        {
          calls: [
            {
              name: "save_skill",
              args: {
                name: "smoke-echo",
                description: "edited desc",
                body: "# edited\n",
                material: "utterance"
              }
            }
          ]
        },
        {
          calls: [
            {
              name: "write_skill_resource",
              args: { name: "smoke-echo", path: "references/notes.md", body: "phrase: edited-ok\n" }
            }
          ]
        },
        { calls: [{ name: "activate_skill", args: { name: "smoke-echo" } }] },
        {
          calls: [
            { name: "read_skill_resource", args: { name: "smoke-echo", path: "references/notes.md" } }
          ]
        },
        { text: "ok" }
      ]
    });
    expect(turn.toolLog[0]).toMatchObject({ ok: true, name: "smoke-echo", updated: true });
    expect(turn.toolLog[1]).toMatchObject({ ok: true, path: "references/notes.md" });
    expect(turn.toolLog[2]).toMatchObject({
      ok: true,
      description: "edited desc",
      instructions: "# edited\n"
    });
    expect(turn.toolLog[3]).toMatchObject({
      ok: true,
      body: expect.stringContaining("edited-ok")
    });
    expect(turn.skills["smoke-echo"]?.description).toBe("edited desc");
  });

  it("smoke-echo（検証用パッケージ）は activate と references 読取ができる", () => {
    const turn = runTurn({
      ledger: emptyLedger(),
      now,
      userText: "smoke-echo を使って",
      skills: smokeSkillShelf(),
      steps: [
        { calls: [{ name: "activate_skill", args: { name: "smoke-echo" } }] },
        {
          calls: [
            { name: "read_skill_resource", args: { name: "smoke-echo", path: "references/notes.md" } }
          ]
        },
        { text: "phrase is fudo-skills-ok" }
      ]
    });
    expect(turn.toolLog[0]).toMatchObject({
      ok: true,
      name: "smoke-echo",
      resources: ["references/notes.md"]
    });
    expect(String((turn.toolLog[0] as { instructions?: string }).instructions || "")).toContain(
      "read_skill_resource"
    );
    expect(turn.toolLog[1]).toMatchObject({
      ok: true,
      path: "references/notes.md",
      body: expect.stringContaining("fudo-skills-ok")
    });
  });

  it("検索結果はスキルの素材にできない", () => {
    const saved = saveUserSkill({ name: "tactic", description: "観点", body: "本文", material: "search" });
    expect(saved.ok).toBe(false);
  });
});

describe("スキルからツールを足せない", () => {
  it("tools 宣言は保存を拒み、一覧は本文を見ない", () => {
    const saved = saveUserSkill({ name: "tactic", description: "観点", body: "tools: [send_mail]", material: "utterance" });
    expect(saved.ok).toBe(false);
    if (!saved.ok) expect(saved.detail).toMatchObject({ constraint: "スキルからツールは足せない" });
    const names = listTools(emptyRegistries());
    expect(names).not.toContain("send_mail");
    expect(names).not.toContain("run_calc");
    expect(names).not.toContain("start_job");
  });
});

describe("段はコードが順に実行し、モデルは飛ばして書けない", () => {
  it("読みの次に書き、未知の段は保存できない", () => {
    const ledger = insertNote(emptyLedger(), "n1");
    const saved = saveWorkflow({
      name: "記帳",
      id: "book",
      steps: [
        { type: "ledger_read", id: "read", kind: "note", recordId: "n1" },
        { type: "ledger_write", id: "write", kind: "note", recordId: "n1", fields: { title: "甲" } }
      ]
    }, emptyRegistries(), new Set(), { sendEnabled: false });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const ran = runWorkflow(saved.workflow, world(ledger));
    expect(ran.log.map((entry) => entry.type)).toEqual(["ledger_read", "ledger_write"]);
    expect(ran.ledger.notes.get("n1")?.title).toBe("甲");
    const skipped = saveWorkflow({
      name: "抜け",
      steps: [{ type: "model_write", id: "x" }]
    }, emptyRegistries(), new Set(), { sendEnabled: false });
    expect(skipped.ok).toBe(false);
    if (!skipped.ok) expect(skipped.reason).toBe("unknown_step");
  });

  it("空の読みは書きを飛ばし、必須が欠ける書きも台帳を変えない", () => {
    const ledger = insertNote(emptyLedger(), "n1");
    const emptyRead = saveWorkflow({
      name: "空",
      steps: [
        { type: "ledger_read", id: "read", kind: "note", recordId: "missing", onEmpty: "post" },
        { type: "ledger_write", id: "write", kind: "note", recordId: "n1", fields: { title: "乙" } },
        { type: "thread_post", id: "post", text: "空だった" }
      ]
    }, emptyRegistries(), new Set(), { sendEnabled: false });
    expect(emptyRead.ok).toBe(true);
    if (!emptyRead.ok) return;
    const ran = runWorkflow(emptyRead.workflow, world(ledger));
    expect(ran.log.map((entry) => entry.id)).toEqual(["read", "post"]);
    expect(ran.ledger.notes.get("n1")?.title).toBe("");
    expect(ran.posts).toEqual(["空だった"]);

    const missing = saveWorkflow({
      name: "欠け",
      steps: [
        { type: "ledger_write", id: "write", kind: "note", recordId: "n1", fields: { body: "だけ" }, onMissing: "post" },
        { type: "thread_post", id: "post", text: "欠けている" }
      ]
    }, emptyRegistries(), new Set(), { sendEnabled: false });
    expect(missing.ok).toBe(true);
    if (!missing.ok) return;
    const skipped = runWorkflow(missing.workflow, world(ledger));
    expect(skipped.ledger.notes.get("n1")?.title).toBe("");
    expect(skipped.posts).toEqual(["欠けている"]);
  });

  it("所見は文章だけで、台帳の数値を変えない", () => {
    const ledger = insertNote(emptyLedger(), "n1");
    const saved = saveWorkflow({
      name: "所見",
      steps: [{ type: "commentary", id: "note", prompt: "まとめて" }]
    }, emptyRegistries(), new Set(), { sendEnabled: false });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const ran = runWorkflow(saved.workflow, world(ledger, { commentary: () => "価格は1円" }));
    expect(ran.posts).toEqual(["価格は1円"]);
    expect(ran.ledger.notes.get("n1")?.value).toBeNull();
  });
});

describe("カードに写した数値は出典にせず、参照の再読だけが出典", () => {
  it("本文の 88888 は未確認のまま、参照の 42 は出典になる", () => {
    const ledger = insertNote(emptyLedger(), "n1", { title: "参照", body: "", value: 42, deletedAt: null });
    const created = applyCardChange({ cards: new Map() }, {
      create: true,
      id: "c1",
      title: "指値",
      body: "見込みは88,888円",
      refs: ["n1"]
    }, now);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(bodyHasNumber(created.card, 88888)).toBe(true);
    expect(sourceValues(created.card, ledger)).toEqual([42]);
    const turn = runTurn({
      ledger,
      board: created.board,
      now,
      userText: "カードは？",
      steps: [
        { calls: [{ name: "show", args: { view: "kanban", focus: "c1" } }] },
        { text: "参照は42、本文は88,888円です。" }
      ]
    });
    expect(turn.text).toContain("88,888円です。");
    const unconfirmed = turn.unconfirmed.map((token) => token.value);
    expect(unconfirmed).toContain(88888);
    expect(unconfirmed).not.toContain(42);
  });
});

describe("画面とエージェントの移動は、同じ不正値で両方失敗する", () => {
  it("着手中はどちらも同じ理由で拒む", () => {
    const created = applyCardChange({ cards: new Map() }, { create: true, id: "c1", title: "指値" }, now);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const user = applyCardChange(created.board, { id: "c1", state: "着手中" }, now);
    const agent = runTurn({
      ledger: emptyLedger(),
      board: created.board,
      now,
      userText: "動かして",
      steps: [{ calls: [{ name: "kanban_update", args: { id: "c1", state: "着手中" } }] }]
    });
    expect(user.ok).toBe(false);
    expect(agent.toolLog[0]).toMatchObject({ ok: false, reason: user.ok ? "invalid_value" : user.reason, detail: user.ok ? {} : user.detail });
    expect(agent.board.cards.get("c1")?.state).toBe("未着手");
  });
});

describe("有効にしたワークフローだけが時計で起き、止めた実行は空振りと書かない", () => {
  it("午前9時の有効なものだけが起き、上限は理由をカードに残す", () => {
    const steps = [{ type: "thread_post", id: "post", text: "起きた" }];
    const enabled = saveWorkflow({
      name: "毎日",
      id: "daily",
      enabled: true,
      schedule: { kind: "daily" },
      steps
    }, emptyRegistries(), new Set(), { sendEnabled: false }, now - 1);
    const disabled = saveWorkflow({
      name: "止めた定期",
      id: "off",
      enabled: false,
      schedule: { kind: "daily" },
      steps
    }, emptyRegistries(), new Set(), { sendEnabled: false }, now - 1);
    expect(enabled.ok && disabled.ok).toBe(true);
    if (!enabled.ok || !disabled.ok) return;
    const fired = fireDue([enabled.workflow, disabled.workflow], world(), now);
    expect(fired.ran).toEqual(["daily"]);
    expect(fired.posts).toEqual(["起きた"]);

    const capped = fireDue([enabled.workflow], world(emptyLedger(), { capHit: true }), now);
    expect(capped.ran).toEqual(["daily"]);
    const card = [...capped.board.cards.values()][0];
    expect(card?.body).toBe(TOKEN_CAP_MESSAGE);
    expect(card?.body).not.toMatch(/無かった|見つから/);
    expect(capped.posts).toEqual([]);
  });

  it("その月に無い日は月末の指定時刻（日本時間）で、cron と1時間未満は拒む", () => {
    expect(new Date(monthlyFireUtc(2026, 2, 31)).toISOString()).toBe("2026-02-28T00:00:00.000Z");
    const monthEnd = monthlyFireUtc(2026, 2, 31);
    const due = fireDue([mustWorkflow({
      name: "月末",
      id: "month",
      enabled: true,
      schedule: { kind: "monthly", date: 31 },
      steps: [{ type: "thread_post", id: "post", text: "月末" }]
    }, monthEnd - 1)], world(), monthEnd);
    expect(due.ran).toEqual(["month"]);
    expect(fireDue([mustWorkflow({
      name: "月末",
      id: "month",
      enabled: true,
      schedule: { kind: "monthly", date: 31 },
      steps: [{ type: "thread_post", id: "post", text: "月末" }]
    }, monthEnd - 1)], world(), monthEnd - 60_000).ran).toEqual([]);
    expect(saveSchedule({ kind: "daily", hour: 8 }, now).ok).toBe(true);
    expect(saveSchedule({ kind: "interval", everyHours: 3 }, now).ok).toBe(true);
    expect(saveSchedule({ kind: "interval", everyHours: 0 }, now).ok).toBe(false);
    expect(saveSchedule({ kind: "daily", cron: "0 9 * * *" }, now).ok).toBe(false);
    expect(saveSchedule({ kind: "daily", interval: "30m" }, now).ok).toBe(false);
  });

  it("7:30 を跨ぐと一度だけ起き、次枠へ進む", () => {
    const at = Date.parse("2026-10-15T00:00:00Z"); // JST 9:00
    const saved = saveWorkflow({
      name: "朝",
      id: "morning",
      enabled: true,
      schedule: { kind: "daily", hour: 7, minute: 30 },
      steps: [{ type: "thread_post", id: "post", text: "朝" }]
    }, emptyRegistries(), new Set(), { sendEnabled: false }, at - 3 * 60 * 60 * 1000);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const first = fireDue([saved.workflow], world(), at);
    expect(first.ran).toEqual(["morning"]);
    expect(first.posts).toEqual(["朝"]);
    expect(first.workflows[0]?.schedule?.nextFireAt).toBeGreaterThan(at);
    expect(fireDue(first.workflows, world(), at).ran).toEqual([]);
  });
});

describe("未登録の計算名と、テンプレートの無い送信段は保存できない", () => {
  it("登録前の計算名は拒み、四条件が揃わない送信も拒む", () => {
    const calc = saveWorkflow({
      name: "計算",
      steps: [{ type: "run_calc", id: "calc", name: "proforma.resolve", input: {} }]
    }, emptyRegistries(), new Set(), { sendEnabled: false });
    expect(calc.ok).toBe(false);
    if (!calc.ok) expect(calc.reason).toBe("unregistered_calc");

    const send = saveWorkflow({
      name: "送信",
      steps: [{ type: "send", id: "send", templateId: "offer", preview: "全文", button: true }]
    }, emptyRegistries(), new Set(), { sendEnabled: true });
    expect(send.ok).toBe(false);
    if (!send.ok) expect(send.reason).toBe("send_blocked");

    const noButton = saveWorkflow({
      name: "送信",
      steps: [{ type: "send", id: "send", templateId: "fixture", preview: "全文", button: false }]
    }, emptyRegistries(), new Set(["fixture"]), { sendEnabled: true });
    expect(noButton.ok).toBe(false);

    const opened = saveWorkflow({
      name: "送信",
      steps: [{ type: "send", id: "send", templateId: "fixture", preview: "全文です", button: true }]
    }, registerCalc(emptyRegistries(), "add"), new Set(["fixture"]), { sendEnabled: true });
    expect(opened.ok).toBe(true);
    expect(listTools(registerCalc(emptyRegistries(), "add"))).toContain("run_calc");

    const job = saveWorkflow({
      name: "仕事",
      steps: [{ type: "start_job", id: "job", name: "crawl" }]
    }, emptyRegistries(), new Set(), { sendEnabled: false });
    expect(job.ok).toBe(false);
    if (!job.ok) expect(job.reason).toBe("unregistered_job");
  });
});

describe("四則の実行", () => {
  it("式の値はコード算出で、名前のある呼び出しは拒む", () => {
    expect(runCode("(1+2)*3")).toEqual({ ok: true, value: 9, badge: "コード算出" });
    expect(runCode("fetch(1)").ok).toBe(false);
    const turn = runTurn({
      ledger: emptyLedger(),
      now,
      userText: "計算して",
      steps: [
        { calls: [{ name: "run_code", args: { source: "1+2*3" } }] },
        { text: "結果は7円です。" }
      ]
    });
    expect(turn.codeMarks).toEqual([7]);
    expect(turn.unconfirmed).toEqual([]);
    expect(turn.ledger.notes.size).toBe(0);
  });
});

function mustWorkflow(raw: unknown, at = now - 1) {
  const saved = saveWorkflow(raw, emptyRegistries(), new Set(), { sendEnabled: false }, at);
  if (!saved.ok) throw new Error(saved.reason);
  return saved.workflow;
}
