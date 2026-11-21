// カンバン。画面の操作とエージェントの操作は同じ関数を通す。本文の数値は出典にしない。
import { numberTokens } from "./grounding";
import type { Ledger } from "./ledger";
import { MEMO_CHARS, NOTE_TITLE_CHARS, UNDO_MS } from "./limits";

export const CARD_STATES = ["未着手", "実行中", "確認待ち", "完了"] as const;
export type CardState = (typeof CARD_STATES)[number];

export const STATE_CONSTRAINT = "状態は未着手、実行中、確認待ち、完了";

/** 旧ラベル。読み込み・ツール引数の両方で正規化する。 */
const LEGACY_CARD_STATES: Readonly<Record<string, CardState>> = {
  準備済み: "実行中"
};

export interface Card {
  title: string;
  state: CardState;
  due: string | null;
  body: string;
  refs: readonly string[];
  deletedAt: number | null;
}

export function normalizeCardState(value: string): string {
  return LEGACY_CARD_STATES[value] ?? value;
}

export function migrateCard(card: Card): Card {
  const state = normalizeCardState(String(card.state));
  if (isState(state)) return state === card.state ? card : { ...card, state };
  return { ...card, state: "未着手" };
}

export interface Board {
  cards: ReadonlyMap<string, Card>;
}

export interface CardChange {
  id: string;
  create?: boolean;
  title?: string;
  state?: string;
  due?: string | null;
  body?: string;
  refs?: readonly string[];
  delete?: boolean;
  undo?: boolean;
}

export type CardResult =
  | { ok: true; board: Board; card: Card }
  | { ok: false; reason: "record_not_found" | "invalid_value"; detail: unknown };

export function emptyBoard(): Board {
  return { cards: new Map() };
}

export function applyCardChange(board: Board, change: CardChange, now: number): CardResult {
  const cards = new Map(board.cards);
  if (change.create) return createCard(cards, change);
  const current = cards.get(change.id);
  if (!current) return fail("record_not_found", { id: change.id });
  if (change.undo) return undoCard(cards, change, current, now);
  if (change.delete) {
    if (current.deletedAt !== null) return { ok: true, board: { cards }, card: current };
    return deleteCard(cards, change, current, now);
  }
  if (current.deletedAt !== null) return fail("record_not_found", { id: change.id });
  return editCard(cards, change, current);
}

/** 出典は参照先の再読だけ。カード本文の数値は捨てる。 */
export function sourceValues(card: Card, ledger: Ledger): number[] {
  const values: number[] = [];
  for (const ref of card.refs) {
    const note = ledger.notes.get(ref);
    if (note && note.deletedAt === null && typeof note.value === "number") values.push(note.value);
  }
  return values;
}

export function bodyHasNumber(card: Card, value: number): boolean {
  return numberTokens(card.body).some((token) => token.value === value);
}

export function boardContext(board: Board, focusId: string | null): {
  focus: { id: string; title: string; state: CardState; due: string | null; body: string; refs: readonly string[] } | null;
  index: { id: string; title: string; state: CardState; due: string | null }[];
} {
  const visible = [...board.cards].filter(([, card]) => card.deletedAt === null);
  const focusCard = focusId ? visible.find(([id]) => id === focusId)?.[1] : undefined;
  return {
    focus: focusId && focusCard
      ? { id: focusId, title: focusCard.title, state: focusCard.state, due: focusCard.due, body: focusCard.body, refs: focusCard.refs }
      : null,
    index: visible
      .filter(([id]) => id !== focusId)
      .map(([id, card]) => ({ id, title: card.title, state: card.state, due: card.due }))
  };
}

function createCard(cards: Map<string, Card>, change: CardChange): CardResult {
  if (!change.id || cards.has(change.id)) return fail("invalid_value", { constraint: "新しいカードには未使用のidが要る" });
  const title = change.title ?? "";
  if (title.length === 0 || title.length > NOTE_TITLE_CHARS) return fail("invalid_value", { constraint: "件名は1字以上200字まで" });
  const state = normalizeCardState(change.state ?? "未着手");
  if (!isState(state)) return fail("invalid_value", { constraint: STATE_CONSTRAINT });
  const body = change.body ?? "";
  if (body.length > MEMO_CHARS) return fail("invalid_value", { constraint: "本文は8000字まで" });
  const due = change.due ?? null;
  if (!validDue(due)) return fail("invalid_value", { constraint: "期限は日付" });
  if (change.refs && change.refs.some((ref) => typeof ref !== "string")) return fail("invalid_value", { constraint: "参照は台帳のid" });
  const card: Card = { title, state, due, body, refs: [...(change.refs ?? [])], deletedAt: null };
  cards.set(change.id, card);
  return { ok: true, board: { cards }, card };
}

function undoCard(cards: Map<string, Card>, change: CardChange, current: Card, now: number): CardResult {
  if (change.delete || change.state !== undefined || change.title !== undefined || change.body !== undefined) {
    return fail("invalid_value", { constraint: "戻す操作と他の変更は同時にできない" });
  }
  if (current.deletedAt === null) return fail("invalid_value", { constraint: "削除済みだけ戻せる" });
  if (now - current.deletedAt > UNDO_MS) return fail("invalid_value", { constraint: "30日を過ぎた" });
  const card = { ...current, deletedAt: null };
  cards.set(change.id, card);
  return { ok: true, board: { cards }, card };
}

function deleteCard(cards: Map<string, Card>, change: CardChange, current: Card, now: number): CardResult {
  if (change.state !== undefined || change.title !== undefined || change.body !== undefined || change.refs !== undefined || change.due !== undefined) {
    return fail("invalid_value", { constraint: "削除と他の変更は同時にできない" });
  }
  const card = { ...current, deletedAt: now };
  cards.set(change.id, card);
  return { ok: true, board: { cards }, card };
}

function editCard(cards: Map<string, Card>, change: CardChange, current: Card): CardResult {
  const card: Card = { ...current, refs: [...current.refs] };
  if (change.state !== undefined) {
    const state = normalizeCardState(change.state);
    if (!isState(state)) return fail("invalid_value", { constraint: STATE_CONSTRAINT });
    card.state = state;
  }
  if (change.title !== undefined) {
    if (change.title.length === 0 || change.title.length > NOTE_TITLE_CHARS) {
      return fail("invalid_value", { constraint: "件名は1字以上200字まで" });
    }
    card.title = change.title;
  }
  if (change.body !== undefined) {
    if (change.body.length > MEMO_CHARS) return fail("invalid_value", { constraint: "本文は8000字まで" });
    card.body = change.body;
  }
  if (change.due !== undefined) {
    if (!validDue(change.due)) return fail("invalid_value", { constraint: "期限は日付" });
    card.due = change.due;
  }
  if (change.refs !== undefined) {
    if (change.refs.some((ref) => typeof ref !== "string")) return fail("invalid_value", { constraint: "参照は台帳のid" });
    card.refs = [...change.refs];
  }
  cards.set(change.id, card);
  return { ok: true, board: { cards }, card };
}

function isState(value: string): value is CardState {
  return (CARD_STATES as readonly string[]).includes(value);
}

function validDue(due: string | null): boolean {
  return due === null || /^\d{4}-\d{2}-\d{2}$/.test(due);
}

function fail(reason: "record_not_found" | "invalid_value", detail: unknown): CardResult {
  return { ok: false, reason, detail };
}
