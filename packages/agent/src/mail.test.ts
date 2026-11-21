import { describe, expect, it } from "vitest";
import { emptyBoard } from "./kanban";
import { commitMail, extractAddresses, MAIL_DAILY_CAP, MAIL_NOTE_CHARS, mailTemplates, previewMail, type MailFields } from "./mail";
import { runWorkflow, saveWorkflow } from "./workflow";
import { emptyLedger } from "./ledger";
import { emptyRegistries } from "./registry";

const documents = [
  { id: "flyer-1", propertyId: "p1", text: "問合せ\n担当 seller@example.com\n別行" },
  { id: "other", propertyId: "p2", text: "other@example.com" }
];

const fields = (over: Partial<MailFields> = {}): MailFields => ({
  kind: "purchase-offer",
  propertyId: "p1",
  propertyName: "北の戸建",
  location: "札幌市北区",
  offerYen: 18_000_000,
  purpose: "",
  senderName: "山田",
  senderContact: "buyer@example.com",
  note: "",
  address: "seller@example.com",
  ...over
});

describe("買付と資料請求", () => {
  it("その物件の資料にあるアドレスだけを候補にする", () => {
    expect(extractAddresses(documents, "p1").map((item) => item.address)).toEqual(["seller@example.com"]);
    expect(extractAddresses(documents, "p1")[0]?.line).toBe(2);
  });

  it("候補が無い物件は、口で打ったアドレスでもプレビューを出さない", () => {
    const missing = previewMail(fields({ propertyId: "p3" }), documents);
    expect(missing).toMatchObject({ ok: false, reason: "no_address" });
    const other = previewMail(fields({ propertyId: "p2", address: "seller@example.com" }), documents);
    expect(other).toMatchObject({ ok: false, reason: "address_not_candidate" });
  });

  it("ボタンと有効化が揃うまで記録せず、監査には本文を出さない", () => {
    const blocked = commitMail(fields(), documents, { button: false, sendEnabled: true, sentAt: 1, prior: [] }, emptyBoard());
    expect(blocked).toMatchObject({ ok: false, reason: "send_blocked" });
    const sentAt = Date.parse("2026-10-15T00:00:00Z");
    const sent = commitMail(fields({ note: "現地の後で" }), documents, { button: true, sendEnabled: true, sentAt, prior: [] }, emptyBoard());
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.record.body).toContain("提示価格: 18000000円");
    expect(sent.record.body).toContain("補足:\n現地の後で");
    expect(sent.audit).toBe("件名: 買付の申込み（北の戸建）　宛先: seller@example.com");
    expect(sent.audit).not.toContain("18000000");
    expect(sent.board.cards.get(`mail-${sentAt}`)?.body).not.toContain("現地の後で");
  });

  it("補足が上限を超えたら全文を作らない", () => {
    const preview = previewMail(fields({ note: "あ".repeat(MAIL_NOTE_CHARS + 1) }), documents);
    expect(preview).toMatchObject({ ok: false, reason: "note_too_long" });
  });

  it("同じ日本時間の日に6通目は記録しない", () => {
    const sentAt = Date.parse("2026-10-15T10:00:00Z");
    const prior = Array.from({ length: MAIL_DAILY_CAP }, (_, index) => ({ sentAt: sentAt + index }));
    const sixth = commitMail(fields(), documents, { button: true, sendEnabled: true, sentAt, prior }, emptyBoard());
    expect(sixth).toMatchObject({ ok: false, reason: "daily_cap" });
  });

  it("保存できた送信段でも、ランナーは送らない", () => {
    const preview = previewMail(fields(), documents);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const saved = saveWorkflow({
      name: "買付",
      enabled: true,
      steps: [{ type: "send", id: "send", templateId: "purchase-offer", preview: preview.preview.body, button: true }]
    }, emptyRegistries(), mailTemplates(), { sendEnabled: true });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const ran = runWorkflow(saved.workflow, {
      ledger: emptyLedger(),
      board: emptyBoard(),
      now: 0,
      posts: [],
      search: () => [],
      commentary: () => "",
      calcs: new Map(),
      jobs: new Map(),
      capHit: false
    });
    expect(ran.log[0]).toMatchObject({ ok: false, detail: { constraint: "送信段は実行しない" } });
    expect(ran.posts).toEqual([]);
  });
});
