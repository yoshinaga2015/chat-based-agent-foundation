// 汎用レコードとスレッドメモの一括採否。物件の項目はここに置かない。
import { z } from "zod";
import { MEMO_CHARS, NOTE_TITLE_CHARS, UNDO_MS } from "./limits";

export const WRITE_REASONS = ["record_not_found", "field_unknown", "invalid_value", "plan_pending"] as const;
export type WriteReason = (typeof WRITE_REASONS)[number];

const Title = z.string().max(NOTE_TITLE_CHARS);
const Body = z.string().max(MEMO_CHARS);
const Value = z.number().finite().nullable();
const MemoBody = z.string().max(MEMO_CHARS);

export interface FieldInfo {
  key: string;
  label: string;
  valueType: string;
  constraint: string;
}

export const NOTE_FIELDS: readonly FieldInfo[] = [
  { key: "title", label: "題", valueType: "文字列", constraint: "200字まで" },
  { key: "body", label: "本文", valueType: "文字列", constraint: "8000字まで" },
  { key: "value", label: "数値", valueType: "数値", constraint: "有限。空は null" }
];

export const MEMO_FIELDS: readonly FieldInfo[] = [
  { key: "memo_body", label: "スレッドメモ", valueType: "文字列", constraint: "8000字まで。更新には読み込み時の版が要る" }
];

const NOTE_SCHEMA: Record<string, z.ZodType> = { title: Title, body: Body, value: Value };

export interface Note {
  title: string;
  body: string;
  value: number | null;
  deletedAt: number | null;
}

export interface Memo {
  version: number;
  body: string;
}

export interface Ledger {
  planPending: boolean;
  notes: ReadonlyMap<string, Note>;
  memos: ReadonlyMap<string, Memo>;
}

export interface WriteOp {
  kind: "note" | "thread_memo";
  id: string;
  fields?: Readonly<Record<string, unknown>>;
  version?: number;
  delete?: boolean;
  undo?: boolean;
}

export interface FieldChange {
  kind: WriteOp["kind"];
  id: string;
  field: string;
  before: unknown;
  after: unknown;
}

export type CommitResult =
  | { ok: true; ledger: Ledger; changes: FieldChange[] }
  | { ok: false; reason: WriteReason; detail: unknown };

export function emptyLedger(): Ledger {
  return { planPending: false, notes: new Map(), memos: new Map() };
}

export function blankNote(): Note {
  return { title: "", body: "", value: null, deletedAt: null };
}

export function insertNote(ledger: Ledger, id: string, note: Note = blankNote()): Ledger {
  const notes = new Map(ledger.notes);
  notes.set(id, { ...note });
  return { ...ledger, notes };
}

export function insertMemo(ledger: Ledger, id: string, memo: Memo = { version: 1, body: "" }): Ledger {
  const memos = new Map(ledger.memos);
  memos.set(id, { ...memo });
  return { ...ledger, memos };
}

export function fieldCatalog(kind: WriteOp["kind"]): readonly FieldInfo[] {
  return kind === "note" ? NOTE_FIELDS : MEMO_FIELDS;
}

/** 点検は仕様の順。先に当たった理由だけを返し、台帳は変えない。 */
export function commitWrites(ledger: Ledger, ops: readonly WriteOp[], now: number): CommitResult {
  if (ops.length === 0) return { ok: true, ledger, changes: [] };
  const missing = ops.find((op) => !visible(ledger, op, now));
  if (missing) return { ok: false, reason: "record_not_found", detail: { id: missing.id } };

  for (const op of ops) {
    const unknown = Object.keys(op.fields ?? {}).filter((key) => !knownField(op.kind, key));
    if (unknown.length > 0) {
      return {
        ok: false,
        reason: "field_unknown",
        detail: { id: op.id, unknown, editable: fieldCatalog(op.kind) }
      };
    }
  }

  for (const op of ops) {
    const invalid = invalidOp(ledger, op, now);
    if (invalid) return { ok: false, reason: "invalid_value", detail: invalid };
  }

  if (ledger.planPending) return { ok: false, reason: "plan_pending", detail: {} };

  return { ok: true, ...applyOps(ledger, ops, now) };
}

function visible(ledger: Ledger, op: WriteOp, _now: number): boolean {
  if (op.kind === "thread_memo") return ledger.memos.has(op.id);
  const note = ledger.notes.get(op.id);
  if (!note) return false;
  if (op.undo || op.delete) return true;
  return note.deletedAt === null;
}

function knownField(kind: WriteOp["kind"], key: string): boolean {
  return fieldCatalog(kind).some((field) => field.key === key);
}

function invalidOp(ledger: Ledger, op: WriteOp, now: number): unknown {
  if (op.delete && op.undo) return { id: op.id, constraint: "削除と復元は同時にできない" };
  if ((op.delete || op.undo) && op.fields && Object.keys(op.fields).length > 0) {
    return { id: op.id, constraint: "削除と復元に項目は渡せない" };
  }
  if (op.kind === "thread_memo" && !op.delete && !op.undo) {
    const memo = ledger.memos.get(op.id);
    if (!memo || op.version !== memo.version) {
      return { id: op.id, field: "version", constraint: "読み込み時の版と一致すること" };
    }
  }
  if (op.undo) {
    if (op.kind === "thread_memo") {
      return { id: op.id, constraint: "メモの復元はできない" };
    }
    const note = ledger.notes.get(op.id);
    if (op.kind !== "note" || !note?.deletedAt) {
      return { id: op.id, constraint: "削除済みのレコードだけ戻せる" };
    }
    if (now - note.deletedAt > UNDO_MS) return { id: op.id, constraint: "30日を過ぎた" };
  }
  for (const [key, value] of Object.entries(op.fields ?? {})) {
    const schema = op.kind === "note" ? NOTE_SCHEMA[key] : MemoBody;
    if (!schema) continue;
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      const info = fieldCatalog(op.kind).find((field) => field.key === key);
      return { id: op.id, field: key, valueType: info?.valueType, constraint: info?.constraint };
    }
  }
  return null;
}

function applyOps(ledger: Ledger, ops: readonly WriteOp[], now: number): { ledger: Ledger; changes: FieldChange[] } {
  const notes = new Map(ledger.notes);
  const memos = new Map(ledger.memos);
  const changes: FieldChange[] = [];
  for (const op of ops) {
    if (op.kind === "note") applyNote(notes, op, now, changes);
    else applyMemo(memos, op, changes);
  }
  return { ledger: { planPending: ledger.planPending, notes, memos }, changes };
}

function applyNote(notes: Map<string, Note>, op: WriteOp, now: number, changes: FieldChange[]): void {
  const current = notes.get(op.id);
  if (!current) return;
  if (op.delete) {
    if (current.deletedAt !== null) return;
    changes.push({ kind: "note", id: op.id, field: "deleted", before: false, after: true });
    notes.set(op.id, { ...current, deletedAt: now });
    return;
  }
  if (op.undo) {
    changes.push({ kind: "note", id: op.id, field: "deleted", before: true, after: false });
    notes.set(op.id, { ...current, deletedAt: null });
    return;
  }
  const next = { ...current };
  for (const [key, value] of Object.entries(op.fields ?? {})) {
    const before = next[key as keyof Note];
    if (key === "title" && typeof value === "string") next.title = value;
    if (key === "body" && typeof value === "string") next.body = value;
    if (key === "value" && (value === null || typeof value === "number")) next.value = value;
    changes.push({ kind: "note", id: op.id, field: key, before, after: value });
  }
  notes.set(op.id, next);
}

function applyMemo(memos: Map<string, Memo>, op: WriteOp, changes: FieldChange[]): void {
  const current = memos.get(op.id);
  if (!current) return;
  if (op.delete) {
    changes.push({ kind: "thread_memo", id: op.id, field: "deleted", before: false, after: true });
    memos.delete(op.id);
    return;
  }
  if (op.undo) return;
  const body = op.fields?.["memo_body"];
  if (typeof body !== "string") return;
  changes.push({ kind: "thread_memo", id: op.id, field: "memo_body", before: current.body, after: body });
  memos.set(op.id, { version: current.version + 1, body });
}
