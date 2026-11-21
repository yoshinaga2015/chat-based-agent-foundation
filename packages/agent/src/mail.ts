// 買付と資料請求だけ。本文はテンプレート。送る事実は画面のボタンだけが残す。
import { applyCardChange, type Board } from "./kanban";

export const MAIL_TEMPLATE_IDS = ["purchase-offer", "document-request"] as const;
export const MAIL_DAILY_CAP = 5;
export const MAIL_NOTE_CHARS = 400;
export const MAIL_PURPOSE_CHARS = 80;

export type MailKind = (typeof MAIL_TEMPLATE_IDS)[number];

export type MailReason =
  | "send_blocked"
  | "unknown_template"
  | "no_address"
  | "address_not_candidate"
  | "note_too_long"
  | "missing_field"
  | "daily_cap"
  | "invalid_value";

export interface MailDocument {
  id: string;
  propertyId: string;
  text: string;
}

export interface AddressCandidate {
  address: string;
  documentId: string;
  propertyId: string;
  line: number;
}

export interface MailFields {
  kind: string;
  propertyId: string;
  propertyName: string;
  location: string;
  offerYen: number | null;
  purpose: string;
  senderName: string;
  senderContact: string;
  note: string;
  address: string;
}

export interface MailRecord {
  kind: MailKind;
  subject: string;
  address: string;
  sentAt: number;
  body: string;
  audit: string;
}

export interface MailPreview {
  kind: MailKind;
  subject: string;
  body: string;
  address: string;
  line: number;
  documentId: string;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function mailTemplates(): ReadonlySet<string> {
  return new Set(MAIL_TEMPLATE_IDS);
}

export function extractAddresses(documents: readonly MailDocument[], propertyId: string): AddressCandidate[] {
  const seen = new Set<string>();
  const found: AddressCandidate[] = [];
  for (const document of documents) {
    if (document.propertyId !== propertyId) continue;
    const lines = document.text.split(/\r?\n/);
    lines.forEach((line, index) => {
      EMAIL.lastIndex = 0;
      for (const match of line.matchAll(EMAIL)) {
        const address = match[0];
        const key = address.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ address, documentId: document.id, propertyId, line: index + 1 });
      }
    });
  }
  return found;
}

export function previewMail(
  fields: MailFields,
  documents: readonly MailDocument[]
): { ok: true; preview: MailPreview; candidates: AddressCandidate[] } | { ok: false; reason: MailReason; detail?: string } {
  const candidates = extractAddresses(documents, fields.propertyId);
  if (!isKind(fields.kind)) return { ok: false, reason: "unknown_template" };
  if (candidates.length === 0) return { ok: false, reason: "no_address" };
  const selected = candidates.find((candidate) => candidate.address.toLowerCase() === fields.address.trim().toLowerCase());
  if (!selected) return { ok: false, reason: "address_not_candidate" };
  const rendered = render(fields);
  if (!rendered.ok) return rendered;
  return {
    ok: true,
    candidates,
    preview: {
      kind: fields.kind,
      subject: rendered.subject,
      body: rendered.body,
      address: selected.address,
      line: selected.line,
      documentId: selected.documentId
    }
  };
}

export function commitMail(
  fields: MailFields,
  documents: readonly MailDocument[],
  gate: { button: boolean; sendEnabled: boolean; sentAt: number; prior: readonly { sentAt: number }[] },
  board: Board
): { ok: true; record: MailRecord; board: Board; audit: string } | { ok: false; reason: MailReason; detail?: string } {
  if (!gate.button || !gate.sendEnabled) return { ok: false, reason: "send_blocked" };
  const preview = previewMail(fields, documents);
  if (!preview.ok) return preview;
  const day = jstDate(gate.sentAt);
  const sentToday = gate.prior.filter((item) => jstDate(item.sentAt) === day).length;
  if (sentToday >= MAIL_DAILY_CAP) return { ok: false, reason: "daily_cap" };
  const record: MailRecord = {
    kind: preview.preview.kind,
    subject: preview.preview.subject,
    address: preview.preview.address,
    sentAt: gate.sentAt,
    body: preview.preview.body,
    audit: `件名: ${preview.preview.subject}　宛先: ${preview.preview.address}`
  };
  const applied = applyCardChange(board, {
    create: true,
    id: `mail-${gate.sentAt}`,
    title: preview.preview.kind === "purchase-offer" ? "買付の申込みを記録した" : "詳細資料の請求を記録した",
    state: "完了",
    body: `${record.audit}\n種別: ${preview.preview.kind}\n送信日時: ${new Date(gate.sentAt).toISOString()}`
  }, gate.sentAt);
  if (!applied.ok) return { ok: false, reason: "invalid_value", detail: applied.reason };
  return { ok: true, record, board: applied.board, audit: record.audit };
}

function render(fields: MailFields): { ok: true; subject: string; body: string } | { ok: false; reason: MailReason; detail?: string } {
  const propertyName = fields.propertyName.trim();
  const location = fields.location.trim();
  const senderName = fields.senderName.trim();
  const senderContact = fields.senderContact.trim();
  const note = fields.note.trim();
  if (!propertyName || !location || !senderName || !senderContact) return { ok: false, reason: "missing_field" };
  if ([...note].length > MAIL_NOTE_CHARS) return { ok: false, reason: "note_too_long" };
  const tail = note ? `\n\n補足:\n${note}` : "";
  if (fields.kind === "purchase-offer") {
    if (fields.offerYen === null || !Number.isInteger(fields.offerYen) || fields.offerYen < 0) {
      return { ok: false, reason: "invalid_value", detail: "提示価格は0以上の整数" };
    }
    return {
      ok: true,
      subject: `買付の申込み（${propertyName}）`,
      body: `${propertyName}\n所在地: ${location}\n提示価格: ${fields.offerYen}円\n送信者: ${senderName}\n連絡先: ${senderContact}${tail}`
    };
  }
  const purpose = fields.purpose.trim();
  if (!purpose) return { ok: false, reason: "missing_field" };
  if ([...purpose].length > MAIL_PURPOSE_CHARS) return { ok: false, reason: "invalid_value", detail: "請求趣旨は80字まで" };
  return {
    ok: true,
    subject: `詳細資料の請求（${propertyName}）`,
    body: `${propertyName}\n所在地: ${location}\n請求趣旨: ${purpose}\n送信者: ${senderName}\n連絡先: ${senderContact}${tail}`
  };
}

function isKind(kind: string): kind is MailKind {
  return (MAIL_TEMPLATE_IDS as readonly string[]).includes(kind);
}

function jstDate(ms: number): string {
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
