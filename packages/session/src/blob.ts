import {
  sanitizeUiParts,
  createDesk,
  insertMemo,
  insertNote,
  migrateCard,
  type Board,
  type Card,
  type Desk,
  type Ledger,
  type Memo,
  type Note,
  type UserSkill,
  type PendingDelete,
  type PendingMcp,
  type PendingMcpOAuth,
  type McpServer,
  type PendingBrowserHandoff,
  type Workflow,
  domainPack,
  isPendingDeleteKind,
  pruneIncompleteMcp
} from "agent";
import { createSession, type Session, type Thread, type UndoEntry } from "./session";
import { settleDeskHitl, type ThreadHitl } from "./threadHitl";

const VERSION = 1;

export interface SessionBlob {
  version: number;
  threads: Thread[];
  activeThreadId: string | null;
  seq: number;
  undoStack: UndoEntry[];
  planPending: boolean;
  pendingPlan: string | null;
  pendingDelete: PendingDelete | null;
  pendingMcp: PendingMcp | null;
  pendingMcpOAuth: PendingMcpOAuth | null;
  pendingAgentWrite: import("agent").PendingAgentWrite | null;
  /** handoff 待ち。落とすと次ターンで browser close され Live View が Disconnected になる。 */
  pendingBrowserHandoff: PendingBrowserHandoff | null;
  notice: string | null;
  /** 能力ペイン専用。旧 blob には無い。 */
  abilityNotice?: string | null;
  posts: string[];
  ran: string[];
  notes: [string, Note][];
  memos: [string, Memo][];
  cards: [string, Card][];
  skills: Record<string, UserSkill>;
  workflows: Workflow[];
  mcpServers: McpServer[];
  mcpUserHosts: string[];
  /** ドメインのパックの資料の表（D1 files）。 */
  files: unknown[];
  /** ドメインのパックの対話側の状態。パック導入前の保存には無く、book・ownedIds を最上位に持つ。 */
  domain?: unknown;
}

export function dumpSession(session: Session): SessionBlob {
  const stored = domainPack().dump(session.desk.domain);
  return {
    version: VERSION,
    threads: session.threads,
    activeThreadId: session.activeThreadId,
    seq: session.seq,
    undoStack: session.undoStack,
    planPending: session.desk.ledger.planPending,
    pendingPlan: session.desk.pendingPlan,
    pendingDelete: session.desk.pendingDelete,
    pendingMcp: session.desk.pendingMcp,
    pendingMcpOAuth: session.desk.pendingMcpOAuth,
    pendingAgentWrite: session.desk.pendingAgentWrite,
    pendingBrowserHandoff: session.desk.pendingBrowserHandoff,
    notice: session.desk.notice,
    abilityNotice: session.desk.abilityNotice,
    posts: session.desk.posts,
    ran: session.desk.ran,
    notes: [...session.desk.ledger.notes.entries()],
    memos: [...session.desk.ledger.memos.entries()],
    cards: [...session.desk.board.cards.entries()],
    skills: { ...session.desk.skills },
    workflows: [...session.desk.workflows],
    mcpServers: [...session.desk.mcpServers],
    mcpUserHosts: [...session.desk.mcpUserHosts],
    files: stored.files,
    domain: stored.dialogue
  };
}

export function loadSession(blob: SessionBlob): Session {
  if (blob.version !== VERSION) return createSession();
  const base = createDesk();
  let ledger: Ledger = {
    planPending: blob.planPending === true,
    notes: new Map(),
    memos: new Map()
  };
  for (const [id, note] of blob.notes ?? []) ledger = insertNote(ledger, id, note);
  for (const [id, memo] of blob.memos ?? []) ledger = insertMemo(ledger, id, memo);
  const cards = new Map<string, Card>(
    (blob.cards ?? []).map(([id, card]) => [id, migrateCard(card)])
  );
  const board: Board = { cards };
  const desk: Desk = {
    ...base,
    ledger,
    board,
    skills: blob.skills ?? {},
    workflows: blob.workflows ?? [],
    posts: blob.posts ?? [],
    ran: blob.ran ?? [],
    notice: blob.notice ?? null,
    abilityNotice: blob.abilityNotice ?? null,
    pendingPlan: blob.pendingPlan ?? null,
    pendingDelete: blob.pendingDelete ?? legacyPendingDelete(blob),
    pendingMcp: blob.pendingMcp ?? null,
    pendingMcpOAuth: blob.pendingMcpOAuth ?? null,
    pendingAgentWrite: normalizePendingAgentWrite(blob.pendingAgentWrite),
    pendingBrowserHandoff: normalizePendingBrowserHandoff(blob.pendingBrowserHandoff),
    mcpServers: pruneIncompleteMcp(
      (blob.mcpServers ?? []).map((server) => ({
        ...server,
        auth: server.auth ?? "none"
      }))
    ),
    mcpUserHosts: blob.mcpUserHosts ?? [],
    domain: domainPack().load({ dialogue: blob.domain, files: blob.files ?? [] }, blob)
  };
  // 旧 blob は承認待ちを desk 1枠で持っていた。保存時の表示中スレッドへ移す。
  return settleDeskHitl(
    {
      desk,
      threads: sanitizeThreadUi(blob.threads ?? []).map(normalizeThreadHitl),
      activeThreadId: blob.activeThreadId ?? null,
      seq: blob.seq ?? 0,
      // 作成 Undo UI 廃止後は積まない。旧セッションの残留も読み捨てる。
      undoStack: []
    },
    Date.now()
  );
}

function normalizeThreadHitl(thread: Thread): Thread {
  const raw = thread.hitl;
  const hitl: ThreadHitl | null =
    raw && typeof raw === "object"
      ? {
          pendingPlan: typeof raw.pendingPlan === "string" ? raw.pendingPlan : null,
          pendingDelete: normalizePendingDelete(raw.pendingDelete),
          pendingMcp: raw.pendingMcp && typeof raw.pendingMcp === "object" ? raw.pendingMcp : null,
          pendingAgentWrite: normalizePendingAgentWrite(raw.pendingAgentWrite)
        }
      : null;
  const browserHandoff = normalizePendingBrowserHandoff(thread.browserHandoff);
  if (!hitl && !browserHandoff && thread.hitl === undefined && thread.browserHandoff === undefined) {
    return thread;
  }
  return { ...thread, hitl, browserHandoff };
}

function normalizePendingDelete(raw: unknown): PendingDelete | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { kind?: unknown; id?: unknown };
  if (typeof row.kind !== "string" || !isPendingDeleteKind(row.kind)) return null;
  if (typeof row.id !== "string" || !row.id.trim()) return null;
  return { kind: row.kind, id: row.id };
}

function sanitizeThreadUi<T extends { lines: { ui?: unknown }[] }>(threads: T[]): T[] {
  return threads.map((thread) => ({
    ...thread,
    lines: thread.lines.map((line) => {
      if (!line.ui) return line;
      const ui = sanitizeUiParts(line.ui);
      return ui.length ? { ...line, ui } : { ...line, ui: undefined };
    })
  }));
}

/** DO 側だけ（対話・メモ・計画）。D1 側フィールドは空で埋める。 */
export function dialogueFromSession(session: Session): Pick<
  SessionBlob,
  | "version"
  | "threads"
  | "activeThreadId"
  | "seq"
  | "undoStack"
  | "planPending"
  | "pendingPlan"
  | "pendingDelete"
  | "pendingMcp"
  | "pendingMcpOAuth"
  | "pendingAgentWrite"
  | "pendingBrowserHandoff"
  | "notice"
  | "abilityNotice"
  | "memos"
  | "posts"
  | "mcpServers"
  | "mcpUserHosts"
  | "domain"
> {
  const full = dumpSession(session);
  return {
    version: full.version,
    threads: full.threads,
    activeThreadId: full.activeThreadId,
    seq: full.seq,
    undoStack: full.undoStack,
    planPending: full.planPending,
    pendingPlan: full.pendingPlan,
    pendingDelete: full.pendingDelete,
    pendingMcp: full.pendingMcp,
    pendingMcpOAuth: full.pendingMcpOAuth,
    pendingAgentWrite: full.pendingAgentWrite,
    pendingBrowserHandoff: full.pendingBrowserHandoff,
    notice: full.notice,
    abilityNotice: full.abilityNotice ?? null,
    memos: full.memos,
    posts: full.posts,
    mcpServers: full.mcpServers,
    mcpUserHosts: full.mcpUserHosts,
    domain: full.domain
  };
}

function normalizePendingAgentWrite(raw: unknown): import("agent").PendingAgentWrite | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const runId = typeof row.runId === "string" ? row.runId.trim() : "";
  const agent = typeof row.agent === "string" ? row.agent.trim() : "";
  const label = typeof row.label === "string" ? row.label.trim() : "";
  if (!runId || !agent || !label) return null;
  const workspace = normalizeAgentWorkspace(row.workspace);
  if (!workspace) return null;
  const changes = Array.isArray(row.changes) ? row.changes.flatMap(normalizeAgentChange) : [];
  if (changes.length === 0) return null;
  return {
    runId,
    agent,
    label,
    workspace,
    changes,
    result: typeof row.result === "string" ? row.result : ""
  };
}

function normalizeAgentWorkspace(raw: unknown): import("agent").PendingAgentWrite["workspace"] | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (row.kind === "files" && Array.isArray(row.docIds)) {
    const docIds = row.docIds.filter((id): id is string => typeof id === "string" && id !== "");
    return docIds.length > 0 ? { kind: "files", docIds } : null;
  }
  if (row.kind === "repo" && typeof row.repo === "string" && row.repo) {
    return typeof row.ref === "string" && row.ref ? { kind: "repo", repo: row.repo, ref: row.ref } : { kind: "repo", repo: row.repo };
  }
  return null;
}

function normalizeAgentChange(raw: unknown): import("agent").AgentChange[] {
  if (!raw || typeof raw !== "object") return [];
  const row = raw as Record<string, unknown>;
  if (typeof row.path !== "string" || !row.path) return [];
  if (row.status !== "added" && row.status !== "modified" && row.status !== "deleted") return [];
  return [{
    path: row.path,
    status: row.status,
    binary: row.binary === true,
    ...(typeof row.diff === "string" ? { diff: row.diff } : {}),
    ...(typeof row.bytes === "number" ? { bytes: row.bytes } : {})
  }];
}

function normalizePendingBrowserHandoff(raw: unknown): PendingBrowserHandoff | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const liveViewUrl = typeof row.liveViewUrl === "string" ? row.liveViewUrl.trim() : "";
  if (!liveViewUrl) return null;
  const reason =
    row.reason === "login" || row.reason === "captcha" || row.reason === "blocked" || row.reason === "other"
      ? row.reason
      : "other";
  const createdAt = typeof row.createdAt === "number" && Number.isFinite(row.createdAt) ? row.createdAt : 0;
  const task =
    typeof row.task === "string" && row.task.trim()
      ? row.task.replace(/\s+/g, " ").trim().slice(0, 200)
      : "";
  const ttl =
    reason === "login" ? 15 * 60_000 : reason === "other" ? 10 * 60_000 : 5 * 60_000;
  const expiresAt =
    typeof row.expiresAt === "number" && Number.isFinite(row.expiresAt) && row.expiresAt > 0
      ? row.expiresAt
      : createdAt + ttl;
  // 共有面が無い旧 localOnly handoff は破棄（偽の引き継ぎカードを出さない）
  if (row.localOnly === true || liveViewUrl.startsWith("fudo-browser-run:")) return null;
  return { reason, task, liveViewUrl, createdAt, expiresAt };
}

function legacyPendingDelete(blob: SessionBlob & {
  pendingDestructive?: { kind?: string; id?: string; delete?: boolean }[];
  pendingCardDelete?: string | null;
}): PendingDelete | null {
  const card = blob.pendingCardDelete;
  if (typeof card === "string" && card) return { kind: "card", id: card };
  const op = blob.pendingDestructive?.[0];
  if (op && (op.kind === "note" || op.kind === "thread_memo") && typeof op.id === "string" && op.delete) {
    return { kind: op.kind, id: op.id };
  }
  return null;
}

export function mergeStores(
  dialogue: ReturnType<typeof dialogueFromSession>,
  ledger: Pick<SessionBlob, "notes" | "cards" | "skills" | "workflows" | "ran" | "files">
): Session {
  return loadSession({
    ...dialogue,
    notes: ledger.notes,
    cards: ledger.cards,
    skills: ledger.skills,
    workflows: ledger.workflows,
    ran: ledger.ran,
    files: ledger.files,
    mcpServers: dialogue.mcpServers ?? [],
    mcpUserHosts: dialogue.mcpUserHosts ?? []
  });
}
