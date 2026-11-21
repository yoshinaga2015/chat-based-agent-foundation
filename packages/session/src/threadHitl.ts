import {
  DEFAULT_THREAD_TITLE,
  type Desk,
  type PendingAgentWrite,
  type PendingBrowserHandoff,
  type PendingDelete,
  type PendingMcp
} from "agent";
import type { Session, Thread } from "./session";

/**
 * 承認待ち（計画・削除・MCP 設定・外部エージェント書き込み）の正本はスレッド。
 * desk の同名欄はターン実行中だけ載せる作業台で、保存時は常に空にする。
 */
export interface ThreadHitl {
  pendingPlan: string | null;
  pendingDelete: PendingDelete | null;
  pendingMcp: PendingMcp | null;
  pendingAgentWrite: PendingAgentWrite | null;
}

function deskHitl(desk: Desk): ThreadHitl | null {
  if (!desk.ledger.planPending) return null;
  return {
    pendingPlan: desk.pendingPlan,
    pendingDelete: desk.pendingDelete,
    pendingMcp: desk.pendingMcp,
    pendingAgentWrite: desk.pendingAgentWrite
  };
}

function deskCarriesHitl(desk: Desk): boolean {
  return desk.ledger.planPending || desk.pendingBrowserHandoff !== null;
}

function clearDeskHitl(desk: Desk): Desk {
  return {
    ...desk,
    ledger: desk.ledger.planPending ? { ...desk.ledger, planPending: false } : desk.ledger,
    pendingPlan: null,
    pendingDelete: null,
    pendingMcp: null,
    pendingAgentWrite: null,
    pendingBrowserHandoff: null
  };
}

function numberOf(id: string): number {
  const value = Number(id.slice(1));
  return Number.isFinite(value) ? value : 0;
}

/** threadId のスレッドを返す。無ければ新規（id は session.ts の ensureThread と同じ採番）。 */
function threadFor(session: Session, threadId: string | null, now: number): { thread: Thread; created: boolean } {
  const found = threadId ? session.threads.find((thread) => thread.id === threadId) : undefined;
  if (found) return { thread: found, created: false };
  return {
    thread: {
      id: threadId ?? `t${session.seq + 1}`,
      title: DEFAULT_THREAD_TITLE,
      titleLocked: false,
      updatedAt: now,
      lines: []
    },
    created: true
  };
}

/** threadId の承認待ちを desk に載せる。他スレッドの枠は desk に出さない。 */
export function mountThreadHitl(session: Session, threadId: string | null): Session {
  const thread = threadId ? session.threads.find((item) => item.id === threadId) : undefined;
  const hitl = thread?.hitl ?? null;
  const desk = clearDeskHitl(session.desk);
  return {
    ...session,
    desk: {
      ...desk,
      ledger: hitl ? { ...desk.ledger, planPending: true } : desk.ledger,
      pendingPlan: hitl?.pendingPlan ?? null,
      pendingDelete: hitl?.pendingDelete ?? null,
      pendingMcp: hitl?.pendingMcp ?? null,
      pendingAgentWrite: hitl?.pendingAgentWrite ?? null,
      pendingBrowserHandoff: thread?.browserHandoff ?? null
    }
  };
}

/** desk 上の承認待ちを threadId へ戻し、desk を空にする。 */
export function stowThreadHitl(session: Session, threadId: string | null, now: number): Session {
  const hitl = deskHitl(session.desk);
  const browserHandoff = session.desk.pendingBrowserHandoff;
  const desk = clearDeskHitl(session.desk);
  const exists = threadId ? session.threads.some((thread) => thread.id === threadId) : false;
  if (!exists && !hitl && !browserHandoff) return { ...session, desk };
  const { thread, created } = threadFor(session, threadId, now);
  const updated: Thread = { ...thread, hitl, browserHandoff };
  return {
    ...session,
    desk,
    threads: created
      ? [...session.threads, updated]
      : session.threads.map((item) => (item.id === updated.id ? updated : item)),
    activeThreadId: session.activeThreadId ?? updated.id,
    seq: Math.max(session.seq, numberOf(updated.id))
  };
}

/** 旧データ・desk 直書きで desk に残った枠を、表示中スレッドへ移す。 */
export function settleDeskHitl(session: Session, now: number): Session {
  if (!deskCarriesHitl(session.desk)) return session;
  return stowThreadHitl(session, session.activeThreadId, now);
}

/** threadId の枠だけ desk に載せて fn を実行し、結果の枠を同じスレッドへ戻す。 */
export function withThreadHitl(
  session: Session,
  threadId: string | null,
  now: number,
  fn: (mounted: Session) => Session
): Session {
  const settled = settleDeskHitl(session, now);
  const target = threadId ?? settled.activeThreadId;
  const next = fn(mountThreadHitl(settled, target));
  return stowThreadHitl(next, target ?? next.activeThreadId, now);
}

export async function withThreadHitlAsync(
  session: Session,
  threadId: string | null,
  now: number,
  fn: (mounted: Session) => Promise<Session>
): Promise<Session> {
  const settled = settleDeskHitl(session, now);
  const target = threadId ?? settled.activeThreadId;
  const next = await fn(mountThreadHitl(settled, target));
  return stowThreadHitl(next, target ?? next.activeThreadId, now);
}

/** 共有ブラウザを人へ渡しているスレッド。ブラウザは1つなので高々1つ。 */
export function browserHandoffThreadId(session: Session): string | null {
  return session.threads.find((thread) => thread.browserHandoff)?.id ?? null;
}

export function currentBrowserHandoff(session: Session): PendingBrowserHandoff | null {
  return (
    session.threads.find((thread) => thread.browserHandoff)?.browserHandoff ??
    session.desk.pendingBrowserHandoff ??
    null
  );
}
