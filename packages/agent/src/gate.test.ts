import { describe, expect, it } from "vitest";
import { DAILY_TOKEN_CAP, UNDO_MS } from "./limits";
import { blankNote, emptyLedger, insertMemo, insertNote } from "./ledger";
import { runTurn, type ModelStep } from "./turn";

const now = Date.parse("2026-10-15T00:00:00Z");

function ledger() {
  return insertMemo(insertNote(emptyLedger(), "n1", blankNote()), "t1");
}

function write(fields: Record<string, unknown>, id = "n1"): ModelStep {
  return { calls: [{ name: "write_records", args: { ops: [{ kind: "note", id, fields }] } }] };
}

describe("対話ループの6場面", () => {
  it("二つの項目は同じ確定に乗り、片方でも不正なら両方捨てる", () => {
    const ok = runTurn({
      ledger: ledger(),
      now,
      userText: "題と数値を書いて",
      steps: [write({ title: "甲", value: 100 }), { text: "書いた" }]
    });
    expect(ok.operation.ok).toBe(true);
    expect(ok.ledger.notes.get("n1")).toMatchObject({ title: "甲", value: 100 });

    const bad = runTurn({
      ledger: ledger(),
      now,
      userText: "題と数値を書いて",
      steps: [
        { calls: [{ name: "write_records", args: { ops: [
          { kind: "note", id: "n1", fields: { title: "甲" } },
          { kind: "note", id: "n1", fields: { value: "100" } }
        ] } }] },
        { text: "書いた" }
      ]
    });
    expect(bad.operation.ok).toBe(false);
    expect(bad.ledger.notes.get("n1")).toMatchObject({ title: "", value: null });
  });

  it("出典の無い数値は文を残したまま未確認になる", () => {
    const result = runTurn({
      ledger: ledger(),
      now,
      userText: "値段は？",
      steps: [{ text: "価格は9,999円です。" }],
      rewrite: (draft) => draft
    });
    expect(result.text).toContain("9,999円");
    expect(result.unconfirmed.map((token) => token.value)).toContain(9999);
  });

  it("割り込みは保留を捨て、時間切れは検証済みの保留を残す", () => {
    const interrupted = runTurn({
      ledger: ledger(),
      now,
      userText: "題を甲に",
      steps: [write({ title: "甲" })],
      stopAfter: { index: 0, reason: "interrupt" }
    });
    expect(interrupted.ledger.notes.get("n1")?.title).toBe("");
    expect(interrupted.operation).toMatchObject({ ok: false, reason: "interrupted" });

    const expired = runTurn({
      ledger: ledger(),
      now,
      userText: "題を甲に",
      steps: [write({ title: "甲" })],
      stopAfter: { index: 0, reason: "timeout" }
    });
    expect(expired.ledger.notes.get("n1")?.title).toBe("甲");
    expect(expired.operation).toMatchObject({ ok: true, reason: "timeout" });
  });

  it("承認待ちの実行計画があると、正しい値でも書けない", () => {
    const pending = ledger();
    const result = runTurn({
      ledger: { ...pending, planPending: true },
      now,
      userText: "題を甲に",
      steps: [write({ title: "甲" }), { text: "変更しました" }]
    });
    expect(result.ledger.notes.get("n1")?.title).toBe("");
    expect(result.operation.reason).toBe("plan_pending");
  });

  it("スキル本文の数値は、ツールを呼ばなくても出典にならない", () => {
    const result = runTurn({
      ledger: ledger(),
      now,
      userText: "いくら？",
      steps: [{ text: "12,345円です。" }],
      skills: { demo: { description: "例", body: "内訳は12,345円と書く。" } },
      rewrite: (draft) => draft
    });
    expect(result.unconfirmed.map((token) => token.value)).toContain(12345);

    const loaded = runTurn({
      ledger: ledger(),
      now,
      userText: "いくら？",
      steps: [
        { calls: [{ name: "read_skill_resource", args: { name: "demo" } }] },
        { text: "12,345円です。" }
      ],
      skills: { demo: { description: "例", body: "内訳は12,345円と書く。" } },
      rewrite: (draft) => draft
    });
    expect(loaded.unconfirmed.map((token) => token.value)).toContain(12345);
  });

  it("web_search の予算超過は上限を返し、返していない URL はリンクにしない", () => {
    let calls = 0;
    const searched = runTurn({
      ledger: ledger(),
      now,
      userText: "公の情報を調べて",
      search: () => {
        calls += 1;
        return [{ url: "https://example.com/a", title: "例", snippet: "本文" }];
      },
      steps: [
        {
          calls: Array.from({ length: 9 }, () => ({
            name: "web_search",
            args: { query: "公定歩合" }
          }))
        },
        { text: "詳細は https://evil.example/x と https://example.com/a です。" }
      ]
    });
    expect(calls).toBe(8);
    expect(searched.toolLog[8]).toMatchObject({ ok: false, reason: "limit" });
    expect(searched.links).toEqual([
      { url: "https://evil.example/x", active: false },
      { url: "https://example.com/a", active: true }
    ]);
  });
});

describe("ループの上限と削除", () => {
  it("日次トークン上限ではモデルを呼ばず、翌日の案内を返す", () => {
    const result = runTurn({
      ledger: ledger(),
      now,
      userText: "続けて",
      tokensToday: DAILY_TOKEN_CAP,
      steps: [{ text: "これは呼ばれない" }]
    });
    expect(result.blocked).toBe(true);
    expect(result.text).toContain("明日");
    expect(result.ledger.notes.get("n1")?.title).toBe("");
  });

  it("メールアドレスを含む検索クエリは送らない", () => {
    let calls = 0;
    const result = runTurn({
      ledger: ledger(),
      now,
      userText: "調べて",
      search: () => {
        calls += 1;
        return [];
      },
      steps: [{ calls: [{ name: "web_search", args: { query: "taro@example.com の住所" } }] }]
    });
    expect(calls).toBe(0);
    expect(result.toolLog[0]).toMatchObject({ ok: false, reason: "email_in_query" });
  });

  it("削除は論理削除で、30日のあいだ戻せる", () => {
    const removed = runTurn({
      ledger: ledger(),
      now,
      userText: "消して",
      allowDestructive: true,
      steps: [{ calls: [{ name: "write_records", args: { ops: [{ kind: "note", id: "n1", delete: true }] } }] }]
    });
    expect(removed.ledger.notes.get("n1")?.deletedAt).toBe(now);
    const restored = runTurn({
      ledger: removed.ledger,
      now: now + UNDO_MS,
      userText: "戻して",
      steps: [{ calls: [{ name: "write_records", args: { ops: [{ kind: "note", id: "n1", undo: true }] } }] }]
    });
    expect(restored.ledger.notes.get("n1")?.deletedAt).toBeNull();
    const late = runTurn({
      ledger: removed.ledger,
      now: now + UNDO_MS + 1,
      userText: "戻して",
      steps: [{ calls: [{ name: "write_records", args: { ops: [{ kind: "note", id: "n1", undo: true }] } }] }]
    });
    expect(late.operation.reason).toBe("invalid_value");
    expect(late.ledger.notes.get("n1")?.deletedAt).toBe(now);
  });

  it("チャットの削除は承認待ちになり、台帳はまだ変えない", () => {
    const pending = runTurn({
      ledger: ledger(),
      now,
      userText: "消して",
      steps: [{ calls: [{ name: "write_records", args: { ops: [{ kind: "note", id: "n1", delete: true }] } }] }]
    });
    expect(pending.ledger.notes.get("n1")?.deletedAt).toBeNull();
    expect(pending.ledger.planPending).toBe(true);
    expect(pending.pendingPlan).toContain("n1");
    expect(pending.pendingDelete).toEqual({ kind: "note", id: "n1" });
    expect(pending.toolLog[0]).toMatchObject({ ok: true, accepted: false, reason: "plan_pending" });
  });

  it("メモは版が一致したときだけ進む", () => {
    const result = runTurn({
      ledger: ledger(),
      now,
      userText: "メモして",
      steps: [{ calls: [{ name: "write_records", args: { ops: [
        { kind: "thread_memo", id: "t1", version: 1, fields: { memo_body: "翌日の確認" } }
      ] } }] }]
    });
    expect(result.ledger.memos.get("t1")).toEqual({ version: 2, body: "翌日の確認" });
  });
});
