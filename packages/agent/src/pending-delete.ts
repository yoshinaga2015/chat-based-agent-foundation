// チャット HITL で承認待ちにする削除。1件だけ。
import type { Board } from "./kanban";
import { applyCardChange } from "./kanban";
import { commitWrites, type Ledger, type WriteOp } from "./ledger";
import type { UserSkill } from "./skills";
import type { Workflow } from "./workflow";

export const PENDING_DELETE_KINDS = ["note", "thread_memo", "card", "skill", "workflow"] as const;
export type PendingDeleteKind = (typeof PENDING_DELETE_KINDS)[number];

export interface PendingDelete {
  kind: PendingDeleteKind;
  id: string;
}

export type ApplyDeleteResult =
  | {
      ok: true;
      ledger: Ledger;
      board: Board;
      skills: Record<string, UserSkill>;
      workflows: Workflow[];
    }
  | { ok: false; reason: string };

export function isPendingDeleteKind(value: unknown): value is PendingDeleteKind {
  return typeof value === "string" && (PENDING_DELETE_KINDS as readonly string[]).includes(value);
}

export function labelPendingDelete(
  pending: PendingDelete,
  world: {
    ledger: Ledger;
    board: Board;
    skills: Readonly<Record<string, UserSkill>>;
    workflows: readonly Workflow[];
  }
): string {
  if (pending.kind === "note") {
    const title = world.ledger.notes.get(pending.id)?.title?.trim();
    return title ? `ノート「${title}」（${pending.id}）を削除する` : `ノート ${pending.id} を削除する`;
  }
  if (pending.kind === "thread_memo") {
    const body = world.ledger.memos.get(pending.id)?.body?.trim().slice(0, 40);
    return body ? `メモ「${body}」（${pending.id}）を削除する` : `メモ ${pending.id} を削除する`;
  }
  if (pending.kind === "card") {
    const title = world.board.cards.get(pending.id)?.title?.trim();
    return title ? `カンバンカード「${title}」（${pending.id}）を削除する` : `カンバンカード ${pending.id} を削除する`;
  }
  if (pending.kind === "skill") {
    return world.skills[pending.id]
      ? `スキル「${pending.id}」を削除する`
      : `スキル ${pending.id} を削除する`;
  }
  const flow = world.workflows.find((item) => item.id === pending.id);
  return flow ? `ワークフロー「${flow.name}」（${pending.id}）を削除する` : `ワークフロー ${pending.id} を削除する`;
}

export function applyPendingDelete(
  world: {
    ledger: Ledger;
    board: Board;
    skills: Readonly<Record<string, UserSkill>>;
    workflows: readonly Workflow[];
  },
  pending: PendingDelete,
  now: number
): ApplyDeleteResult {
  if (pending.kind === "note" || pending.kind === "thread_memo") {
    const op: WriteOp = { kind: pending.kind, id: pending.id, delete: true };
    const committed = commitWrites({ ...world.ledger, planPending: false }, [op], now);
    if (!committed.ok) return { ok: false, reason: committed.reason };
    return {
      ok: true,
      ledger: { ...committed.ledger, planPending: false },
      board: world.board,
      skills: { ...world.skills },
      workflows: [...world.workflows]
    };
  }
  if (pending.kind === "card") {
    const applied = applyCardChange(world.board, { id: pending.id, delete: true }, now);
    if (!applied.ok) return { ok: false, reason: applied.reason };
    return {
      ok: true,
      ledger: { ...world.ledger, planPending: false },
      board: applied.board,
      skills: { ...world.skills },
      workflows: [...world.workflows]
    };
  }
  if (pending.kind === "skill") {
    if (!(pending.id in world.skills)) return { ok: false, reason: "record_not_found" };
    const skills = { ...world.skills };
    delete skills[pending.id];
    return {
      ok: true,
      ledger: { ...world.ledger, planPending: false },
      board: world.board,
      skills,
      workflows: [...world.workflows]
    };
  }
  if (!world.workflows.some((item) => item.id === pending.id)) {
    return { ok: false, reason: "record_not_found" };
  }
  return {
    ok: true,
    ledger: { ...world.ledger, planPending: false },
    board: world.board,
    skills: { ...world.skills },
    workflows: world.workflows.filter((item) => item.id !== pending.id)
  };
}

export function findPendingDeleteTarget(
  world: {
    ledger: Ledger;
    board: Board;
    skills: Readonly<Record<string, UserSkill>>;
    workflows: readonly Workflow[];
  },
  pending: PendingDelete
): boolean {
  if (pending.kind === "note") {
    const note = world.ledger.notes.get(pending.id);
    return Boolean(note && note.deletedAt === null);
  }
  if (pending.kind === "thread_memo") return world.ledger.memos.has(pending.id);
  if (pending.kind === "card") {
    const card = world.board.cards.get(pending.id);
    return Boolean(card && card.deletedAt === null);
  }
  if (pending.kind === "skill") return pending.id in world.skills;
  return world.workflows.some((item) => item.id === pending.id);
}
