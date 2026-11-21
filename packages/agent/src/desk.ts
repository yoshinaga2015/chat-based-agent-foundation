// 評価卓が画面と対話で共有する状態。本番の入口にはしない。
import { domainPack } from "./domain";
import { emptyBoard, applyCardChange, type Board, type CardChange } from "./kanban";
import { emptyLedger, insertMemo, insertNote, type Ledger } from "./ledger";
import { applyPendingDelete, type PendingDelete } from "./pending-delete";
import { publicCatalog } from "./mcp-catalog";
import {
  applyPendingMcp,
  pruneIncompleteMcp,
  removeMcp,
  saveMcp,
  sealServerSecret,
  viewMcpServers,
  type McpSaveInput,
  type McpServer,
  type PendingMcp
} from "./mcp";
import type { PendingMcpOAuth } from "./mcp-oauth";
import { sealMcpSecret } from "./mcp-secret-crypto";
import { cliAllowFromEnv, mcpHostAllowFromEnv } from "./mcp-cli-tools";
import { commitMail, extractAddresses, mailTemplates, previewMail, type AddressCandidate, type MailDocument, type MailFields, type MailPreview, type MailRecord } from "./mail";
import { emptyRegistries, registerCalc, registerJob, type Registries } from "./registry";
import { bundledSkillShelf } from "./bundledSkills";
import type { UserSkill } from "./skills";
import type { PendingBrowserHandoff } from "./browserSession";
import {
  resolvePendingAgentWrite,
  type AgentHost,
  type PendingAgentWrite
} from "./runAgent";
import { AGENT_CATALOG, agentAllowFromEnv } from "./agentCatalog";
import { runTurn, type TurnResult } from "./turn";
import { fireDue, saveWorkflow, type FlowWorld, type Workflow } from "./workflow";

export const DEMO_JOB = "demo.ping";
export const LEDGER_SNAPSHOT_JOB = "ledger.snapshot";

export interface Desk {
  ledger: Ledger;
  board: Board;
  skills: Record<string, UserSkill>;
  workflows: Workflow[];
  registries: Registries;
  sendEnabled: boolean;
  posts: string[];
  last: TurnResult | null;
  ran: string[];
  notice: string | null;
  /** 能力ペイン専用。スレッド／カンバンの Banner には出さない。 */
  abilityNotice: string | null;
  pendingPlan: string | null;
  pendingDelete: PendingDelete | null;
  pendingMcp: PendingMcp | null;
  pendingAgentWrite: PendingAgentWrite | null;
  pendingBrowserHandoff: PendingBrowserHandoff | null;
  pendingMcpOAuth: PendingMcpOAuth | null;
  mcpServers: McpServer[];
  /** カタログ外でユーザーが明示確認したホスト。 */
  mcpUserHosts: string[];
  /** 差し込まれたドメインのパックが持つ状態。殻は中身を見ない。 */
  domain: unknown;
  mailDocuments: MailDocument[];
  mailFields: MailFields | null;
  mailPreview: MailPreview | null;
  mailCandidates: AddressCandidate[];
  sends: MailRecord[];
  mailCardOpen: boolean;
}

export function createDesk(): Desk {
  const pack = domainPack();
  const withCalcs = pack.calcNames.reduce((registries, name) => registerCalc(registries, name), emptyRegistries());
  return {
    ledger: emptyLedger(),
    board: emptyBoard(),
    skills: {},
    workflows: [],
    sendEnabled: false,
    posts: [],
    last: null,
    ran: [],
    notice: null,
    abilityNotice: null,
    pendingPlan: null,
    pendingDelete: null,
    pendingMcp: null,
    pendingAgentWrite: null,
    pendingBrowserHandoff: null,
    pendingMcpOAuth: null,
    mcpServers: [],
    mcpUserHosts: [],
    domain: pack.empty(),
    mailDocuments: [],
    mailFields: null,
    mailPreview: null,
    mailCandidates: [],
    sends: [],
    mailCardOpen: false,
    registries: registerJob(registerJob(withCalcs, DEMO_JOB), LEDGER_SNAPSHOT_JOB)
  };
}

export function deskDraftSkill(desk: Desk, input: { name: string; description: string; body: string; material: "utterance" | "memo" }, now: number): Desk {
  const turn = runTurn({
    ...deskTurnInput(desk, now, "スキルを作って読んで"),
    steps: [
      { calls: [{ name: "save_skill", args: input }] },
      { calls: [{ name: "activate_skill", args: { name: input.name } }, { name: "read_skill_resource", args: { name: input.name } }] },
      { text: input.body }
    ]
  });
  const saved = turn.toolLog[0];
  const failed = saved && typeof saved === "object" && "ok" in saved && saved.ok === false;
  return { ...deskApplyTurn(desk, turn), notice: failed ? "スキルは保存できなかった" : null };
}

export function deskAddCard(desk: Desk, title: string, now: number, state?: string): Desk {
  const id = `card-${desk.board.cards.size + 1}`;
  return applyCard(desk, { create: true, id, title, ...(state ? { state } : {}) }, now);
}

export function deskMoveCard(desk: Desk, id: string, state: string, now: number): Desk {
  return applyCard(desk, { id, state }, now);
}

export function deskSaveWorkflow(desk: Desk, raw: unknown, now = Date.now()): Desk {
  const saved = saveWorkflow(raw, desk.registries, mailTemplates(), { sendEnabled: desk.sendEnabled }, now);
  if (!saved.ok) return { ...desk, notice: saved.reason };
  return { ...desk, workflows: [...desk.workflows, saved.workflow], notice: null };
}

export function deskEnable(desk: Desk, id: string, enabled: boolean): Desk {
  return {
    ...desk,
    workflows: desk.workflows.map((workflow) => workflow.id === id ? { ...workflow, enabled } : workflow),
    notice: null
  };
}

export function deskProposePlan(
  desk: Desk,
  text: string,
  now: number,
  jev: (plan: string) => boolean | "down" = () => "down"
): Desk {
  const plan = text.trim();
  if (!plan) return { ...desk, notice: "実行計画の本文が要る" };
  const turn = runTurn({
    ...deskTurnInput(desk, now, "実行計画を出す"),
    jev,
    steps: [
      { calls: [{ name: "propose_plan", args: { text: plan } }] },
      { text: "実行計画を出しました。承認するか却下してください。" }
    ]
  });
  const rejected = turn.toolLog[0] && typeof turn.toolLog[0] === "object"
    && "ok" in turn.toolLog[0] && turn.toolLog[0].ok === false;
  if (rejected) {
    return {
      ...desk,
      notice: "保存の意図が確認できなかったため、実行計画は出しません。"
    };
  }
  return deskApplyTurn(desk, turn);
}

export async function deskResolvePlan(
  desk: Desk,
  decision: "approve" | "reject",
  now = Date.now(),
  opts: { agentHost?: AgentHost } = {}
): Promise<Desk> {
  if (!desk.ledger.planPending) return { ...desk, notice: "承認待ちの実行計画はない" };
  if (desk.pendingAgentWrite) {
    const resolved = await resolvePendingAgentWrite(desk.pendingAgentWrite, decision, opts.agentHost);
    if (!resolved.ok && decision === "approve") {
      // 書き戻しに失敗したら承認待ちを残す。複製は実行先が保持したまま。
      return { ...desk, notice: resolved.notice };
    }
    return {
      ...desk,
      ledger: { ...desk.ledger, planPending: false },
      pendingPlan: null,
      pendingDelete: null,
      pendingMcp: null,
      pendingAgentWrite: null,
      notice: resolved.notice
    };
  }
  if (decision === "reject") {
    return {
      ...desk,
      ledger: { ...desk.ledger, planPending: false },
      pendingPlan: null,
      pendingDelete: null,
      pendingMcp: null,
      pendingAgentWrite: null,
      notice: "実行計画を却下した。"
    };
  }
  if (desk.pendingMcp) {
    const applied = applyPendingMcp(desk.mcpServers, desk.pendingMcp);
    if (!applied.ok) {
      return { ...desk, notice: `MCP 設定に失敗した。理由は ${applied.detail.constraint}` };
    }
    const userHosts = applied.grantHost && !desk.mcpUserHosts.includes(applied.grantHost)
      ? [...desk.mcpUserHosts, applied.grantHost]
      : desk.mcpUserHosts;
    const mcpServers = await Promise.all(applied.servers.map((server) => sealServerSecret(server)));
    return {
      ...desk,
      ledger: { ...desk.ledger, planPending: false },
      mcpServers,
      mcpUserHosts: userHosts,
      pendingPlan: null,
      pendingDelete: null,
      pendingMcp: null,
      pendingAgentWrite: null,
      notice: desk.pendingMcp.op === "remove" ? "MCP を削除した。" : "MCP を登録した。"
    };
  }
  if (!desk.pendingDelete) {
    return {
      ...desk,
      ledger: { ...desk.ledger, planPending: false },
      pendingPlan: null,
      pendingDelete: null,
      pendingMcp: null,
      pendingAgentWrite: null,
      notice: "実行計画を承認した。"
    };
  }
  const applied = applyPendingDelete(desk, desk.pendingDelete, now);
  if (!applied.ok) {
    return { ...desk, notice: `削除に失敗した。理由は ${applied.reason}` };
  }
  return {
    ...desk,
    ledger: applied.ledger,
    board: applied.board,
    skills: applied.skills,
    workflows: applied.workflows,
    pendingPlan: null,
    pendingDelete: null,
    pendingMcp: null,
    pendingAgentWrite: null,
    notice: "削除した。"
  };
}

/** 能力ペインからの MCP 登録（面内。HITL 外）。 */
function envBag(): Record<string, string | undefined> {
  try {
    return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  } catch {
    return {};
  }
}

export async function deskSaveMcp(
  desk: Desk,
  input: McpSaveInput & { name?: string; url?: string },
  allowHosts = mcpHostAllowFromEnv(envBag(), desk.mcpUserHosts)
): Promise<Desk> {
  const sealedInput = input.secret
    ? { ...input, secret: await sealMcpSecret(input.secret) }
    : input;
  const saved = saveMcp(desk.mcpServers, sealedInput, allowHosts);
  if (!saved.ok) return { ...desk, notice: saved.detail.constraint };
  const userHosts = saved.grantHost && !desk.mcpUserHosts.includes(saved.grantHost)
    ? [...desk.mcpUserHosts, saved.grantHost]
    : desk.mcpUserHosts;
  return { ...desk, mcpServers: saved.servers, mcpUserHosts: userHosts, notice: null };
}

/** 能力ペインからの MCP 削除（面内。HITL 外）。 */
export function deskRemoveMcp(desk: Desk, id: string): Desk {
  const removed = removeMcp(desk.mcpServers, id);
  if (!removed.ok) return { ...desk, notice: removed.detail.constraint };
  return { ...desk, mcpServers: removed.servers, pendingMcpOAuth: null, notice: null };
}

/** OAuth 開始。pending だけ載せ、サーバ行はコールバックで確定する。 */
export function deskSetPendingMcpOAuth(desk: Desk, pending: PendingMcpOAuth): Desk {
  const withoutHollow = pruneIncompleteMcp(desk.mcpServers).filter((server) => {
    if (pending.catalogId && server.catalogId === pending.catalogId) return false;
    if (server.id === pending.catalogId) return false;
    return true;
  });
  return { ...desk, mcpServers: withoutHollow, pendingMcpOAuth: pending, notice: null };
}

/** OAuth コールバック成功後の確定。 */
export async function deskCompleteMcpOAuth(
  desk: Desk,
  secret: string,
  allowHosts = mcpHostAllowFromEnv(envBag(), desk.mcpUserHosts)
): Promise<Desk> {
  const pending = desk.pendingMcpOAuth;
  if (!pending) return { ...desk, notice: "OAuth 待ちがない" };
  const sealed = await sealMcpSecret(secret);
  const withoutOld = desk.mcpServers.filter((server) => {
    if (pending.catalogId && server.catalogId === pending.catalogId) return false;
    if (server.id === pending.catalogId) return false;
    return true;
  });
  const saved = saveMcp(
    withoutOld,
    {
      catalogId: pending.catalogId,
      name: pending.name,
      url: pending.mcpUrl,
      auth: "oauth",
      secret: sealed
    },
    allowHosts
  );
  if (!saved.ok) {
    return { ...desk, pendingMcpOAuth: null, notice: saved.detail.constraint };
  }
  const sealedServers = await Promise.all(saved.servers.map((server) => sealServerSecret(server)));
  const userHosts = saved.grantHost && !desk.mcpUserHosts.includes(saved.grantHost)
    ? [...desk.mcpUserHosts, saved.grantHost]
    : desk.mcpUserHosts;
  return {
    ...desk,
    mcpServers: sealedServers,
    mcpUserHosts: userHosts,
    pendingMcpOAuth: null,
    notice: null
  };
}

export function deskFailMcpOAuth(desk: Desk, reason: string): Desk {
  return { ...desk, pendingMcpOAuth: null, notice: reason };
}

export function deskDeleteItem(desk: Desk, pending: PendingDelete, now: number): Desk {
  const turn = runTurn({
    ...deskTurnInput(desk, now, "削除する"),
    allowDestructive: true,
    steps: [{ calls: [{ name: "delete_item", args: pending }] }]
  });
  return {
    ...deskApplyTurn(desk, turn),
    notice: turn.operation.ok ? "削除した。" : `削除に失敗した。理由は ${turn.operation.reason}`
  };
}

export function deskWriteNote(desk: Desk, input: { id: string; title: string; body: string; value?: number | null }, now: number): Desk {
  const id = input.id.trim() || `note-${desk.ledger.notes.size + 1}`;
  const seeded = desk.ledger.notes.has(id) ? desk : { ...desk, ledger: insertNote(desk.ledger, id) };
  const fields: Record<string, unknown> = { title: input.title, body: input.body };
  if (input.value !== undefined) fields.value = input.value;
  const turn = runTurn({
    ...deskTurnInput(seeded, now, "ノートを書く"),
    steps: [{ calls: [{ name: "write_records", args: { ops: [{ kind: "note", id, fields }] } }] }]
  });
  return {
    ...deskApplyTurn(seeded, turn),
    notice: turn.operation.ok ? null : `ノートを書けなかった。理由は ${turn.operation.reason}`
  };
}

export function deskWriteMemo(desk: Desk, input: { id: string; body: string }, now: number): Desk {
  const id = input.id.trim() || `memo-${desk.ledger.memos.size + 1}`;
  const seeded = desk.ledger.memos.has(id) ? desk : { ...desk, ledger: insertMemo(desk.ledger, id) };
  const version = seeded.ledger.memos.get(id)?.version ?? 1;
  const turn = runTurn({
    ...deskTurnInput(seeded, now, "メモを書く"),
    steps: [{ calls: [{ name: "write_records", args: { ops: [{ kind: "thread_memo", id, version, fields: { memo_body: input.body } }] } }] }]
  });
  return {
    ...deskApplyTurn(seeded, turn),
    notice: turn.operation.ok ? null : `メモを書けなかった。理由は ${turn.operation.reason}`
  };
}

export function deskStartJob(desk: Desk, name: string, now: number): Desk {
  const turn = runTurn({
    ...deskTurnInput(desk, now, "ジョブを起動する"),
    jobs: deskJobs(desk),
    steps: [
      { calls: [{ name: "start_job", args: { name } }] },
      { text: jobPhrase(name) }
    ]
  });
  const result = turn.toolLog[0];
  const failed = result && typeof result === "object" && "ok" in result && result.ok === false;
  return {
    ...deskApplyTurn(desk, turn),
    ran: failed ? desk.ran : [...desk.ran, name],
    notice: failed ? `ジョブは起動できなかった。理由は ${typeof result === "object" && result && "reason" in result ? String(result.reason) : "unknown"}` : null
  };
}

export function deskJobs(desk: Desk): Map<string, (input: unknown) => { ok: boolean; reason?: string; detail?: unknown }> {
  return new Map([
    [DEMO_JOB, () => ({ ok: true, reason: "ping" })],
    [LEDGER_SNAPSHOT_JOB, () => {
      const notes = [...desk.ledger.notes].filter(([, note]) => note.deletedAt === null).length;
      const memos = desk.ledger.memos.size;
      const cards = [...desk.board.cards].filter(([, card]) => card.deletedAt === null).length;
      return { ok: true, reason: "snapshot", detail: { notes, memos, cards } };
    }]
  ]);
}

function jobPhrase(name: string): string {
  if (name === DEMO_JOB) return "demo.ping を起動した。";
  if (name === LEDGER_SNAPSHOT_JOB) return "ledger.snapshot を起動した。ノート件数を返した。";
  return `ジョブ ${name} を起動した。`;
}

/** 論理削除。30日 Undo の入り口。 */
export function deskDeleteNote(desk: Desk, id: string, now: number): Desk {
  if (!desk.ledger.notes.has(id) || desk.ledger.notes.get(id)?.deletedAt !== null) {
    return { ...desk, notice: "取り消せるノートはない" };
  }
  const turn = runTurn({
    ...deskTurnInput(desk, now, "ノートを取り消す"),
    allowDestructive: true,
    steps: [{ calls: [{ name: "write_records", args: { ops: [{ kind: "note", id, delete: true }] } }] }]
  });
  return {
    ...deskApplyTurn(desk, turn),
    notice: turn.operation.ok ? "ノートを取り消した。" : `取り消しに失敗した。理由は ${turn.operation.reason}`
  };
}

export function deskDeleteCard(desk: Desk, id: string, now: number): Desk {
  return applyCard(desk, { id, delete: true }, now);
}

export function deskRestoreNote(desk: Desk, id: string, now: number): Desk {
  const turn = runTurn({
    ...deskTurnInput(desk, now, "ノートを戻す"),
    steps: [{ calls: [{ name: "write_records", args: { ops: [{ kind: "note", id, undo: true }] } }] }]
  });
  return {
    ...deskApplyTurn(desk, turn),
    notice: turn.operation.ok ? "ノートを戻した。" : `復元に失敗した。理由は ${turn.operation.reason}`
  };
}

export function deskRestoreCard(desk: Desk, id: string, now: number): Desk {
  return applyCard(desk, { id, undo: true }, now);
}

export function deskAdvance(desk: Desk, now: number): Desk {
  const out = fireDue(desk.workflows, worldOf(desk, now), now);
  const calc = [...out.log].reverse().find((entry) => entry.type === "run_calc");
  const job = [...out.log].reverse().find((entry) => entry.type === "start_job");
  return {
    ...desk,
    ledger: out.ledger,
    board: out.board,
    workflows: out.workflows,
    posts: out.posts,
    ran: out.ran,
    notice: calc ? calcNotice(calc) : job ? jobNotice(job) : out.ran.length === 0 ? "この時刻に、有効なワークフローは起きない" : null
  };
}

export function deskAllowSend(desk: Desk, sendEnabled: boolean): Desk {
  return { ...desk, sendEnabled, notice: null };
}

export function deskMailSource(desk: Desk, document: MailDocument): Desk {
  const mailDocuments = [...desk.mailDocuments.filter((item) => item.id !== document.id), document];
  const mailCandidates = extractAddresses(mailDocuments, document.propertyId);
  return {
    ...desk,
    mailDocuments,
    mailCandidates,
    notice: mailCandidates.length === 0 ? "no_address" : null
  };
}

export function deskMailPreview(desk: Desk, fields: MailFields): Desk {
  const preview = previewMail(fields, desk.mailDocuments);
  if (!preview.ok) return { ...desk, mailPreview: null, mailCardOpen: false, notice: preview.reason };
  return { ...desk, mailFields: fields, mailPreview: preview.preview, mailCandidates: preview.candidates, mailCardOpen: true, notice: null };
}

export function deskMailSend(desk: Desk, now: number): Desk {
  if (!desk.mailFields) return { ...desk, notice: "missing_field" };
  const sent = commitMail(desk.mailFields, desk.mailDocuments, {
    button: true,
    sendEnabled: desk.sendEnabled,
    sentAt: now,
    prior: desk.sends
  }, desk.board);
  if (!sent.ok) return { ...desk, notice: sent.reason };
  return {
    ...desk,
    board: sent.board,
    sends: [...desk.sends, sent.record],
    posts: [...desk.posts, sent.audit],
    mailCardOpen: false,
    notice: null
  };
}

export function deskSpeak(desk: Desk, text: string, now: number): Desk {
  if (/送って/.test(text.trim())) {
    return {
      ...desk,
      mailCardOpen: desk.mailPreview !== null,
      notice: desk.mailPreview ? "確認カードを開いた。送信は画面のボタンだけが行う。" : "確認カードを開くには、文面の項目が要る。"
    };
  }
  const read = /^読んで[:：]\s*(.+)$/.exec(text.trim());
  if (!read) {
    const turn = runTurn({
      ...deskTurnInput(desk, now, text),
      steps: [{ text: "対話モデルの識別子は空です。スキル、カード、ワークフローは評価卓のフォームから操作します。" }]
    });
    return deskApplyTurn(desk, turn);
  }
  const name = read[1]?.trim() ?? "";
  const skill = desk.skills[name];
  const turn = runTurn({
    ...deskTurnInput(desk, now, text),
    steps: skill
      ? [
          { calls: [{ name: "activate_skill", args: { name } }, { name: "read_skill_resource", args: { name } }] },
          { text: skill.body }
        ]
      : [{ text: "そのスキルは無い。" }]
  });
  return deskApplyTurn(desk, turn);
}

export function deskInterrupt(desk: Desk, now: number): Desk {
  const turn = runTurn({
    ...deskTurnInput(desk, now, "やめて"),
    steps: [{ calls: [{ name: "kanban_add", args: { id: "interrupted-card", title: "途中" } }] }],
    stopAfter: { index: 0, reason: "interrupt" }
  });
  return { ...deskApplyTurn(desk, turn), notice: "割り込みにより、保留中の変更を破棄した" };
}

export function snapshot(desk: Desk): unknown {
  return {
    model: "",
    localOnly: true,
    notice: desk.notice,
    posts: desk.posts,
    ran: desk.ran,
    sendEnabled: desk.sendEnabled,
    planPending: desk.ledger.planPending,
    pendingPlan: desk.pendingPlan,
    pendingDelete: desk.pendingDelete,
    pendingMcp: desk.pendingMcp,
    pendingAgentWrite: desk.pendingAgentWrite,
    pendingBrowserHandoff: desk.pendingBrowserHandoff,
    mcpServers: viewMcpServers(desk.mcpServers),
    mcpCatalog: publicCatalog(),
    agentCatalog: AGENT_CATALOG.map((row) => ({ id: row.id, name: row.name })),
    agentAllow: agentAllowFromEnv(envBag()),
    mcpUserHosts: [...desk.mcpUserHosts],
    mcpHostAllow: mcpHostAllowFromEnv(envBag(), desk.mcpUserHosts),
    cliAllow: cliAllowFromEnv(envBag()),
    notes: [...desk.ledger.notes].flatMap(([id, note]) => note.deletedAt === null ? [{ id, title: note.title, body: note.body, value: note.value }] : []),
    memos: [...desk.ledger.memos].map(([id, memo]) => ({ id, body: memo.body, version: memo.version })),
    jobs: [...desk.registries.jobs],
    skills: Object.values({ ...bundledSkillShelf(), ...desk.skills }),
    cards: [...desk.board.cards].flatMap(([id, card]) => card.deletedAt === null ? [{ id, title: card.title, state: card.state, due: card.due, body: card.body, refs: card.refs }] : []),
    workflows: desk.workflows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      enabled: workflow.enabled,
      schedule: workflow.schedule,
      steps: workflow.steps.map((step) => step.type)
    })),
    last: desk.last
      ? {
          text: desk.last.text,
          unconfirmed: desk.last.unconfirmed,
          codeMarks: desk.last.codeMarks,
          operation: desk.last.operation,
          blocked: desk.last.blocked
        }
      : null,
    mailPreview: desk.mailPreview,
    mailCandidates: desk.mailCandidates.map((candidate) => ({
      address: candidate.address,
      documentId: candidate.documentId,
      line: candidate.line
    })),
    mailCardOpen: desk.mailCardOpen,
    sends: desk.sends.map((record) => ({
      kind: record.kind,
      subject: record.subject,
      address: record.address,
      sentAt: record.sentAt,
      audit: record.audit
    })),
    ...(domainPack().view?.(desk) ?? {})
  };
}

function applyCard(desk: Desk, change: CardChange, now: number): Desk {
  const applied = applyCardChange(desk.board, change, now);
  if (!applied.ok) return { ...desk, notice: typeof applied.detail === "object" && applied.detail && "constraint" in applied.detail ? String(applied.detail.constraint) : applied.reason };
  return { ...desk, board: applied.board, notice: null };
}

export function deskApplyTurn(desk: Desk, turn: TurnResult): Desk {
  const planPending = turn.ledger.planPending;
  return {
    ...desk,
    ledger: turn.ledger,
    board: turn.board,
    skills: { ...turn.skills },
    workflows: [...turn.workflows],
    posts: turn.text ? [...desk.posts, turn.text] : desk.posts,
    last: turn,
    pendingPlan: planPending ? (turn.pendingPlan ?? desk.pendingPlan) : null,
    pendingDelete: planPending ? turn.pendingDelete : null,
    pendingMcp: planPending ? turn.pendingMcp : null,
    pendingAgentWrite: planPending ? turn.pendingAgentWrite : null,
    pendingBrowserHandoff: turn.pendingBrowserHandoff,
    mcpServers: turn.mcpServers,
    mcpUserHosts: desk.mcpUserHosts,
    ...(turn.domain !== undefined ? { domain: turn.domain } : {}),
    notice: null
  };
}

/** ユーザーが「完了」したあとの再開用。pending を外しセッションは act 側に残す。 */
export function deskClearBrowserHandoff(desk: Desk): Desk {
  return { ...desk, pendingBrowserHandoff: null, notice: null };
}

export function deskTurnInput(desk: Desk, now: number, userText: string) {
  return {
    ledger: desk.ledger,
    board: desk.board,
    userSkills: desk.skills,
    workflows: desk.workflows,
    mcpServers: desk.mcpServers,
    mcpUserHosts: desk.mcpUserHosts,
    mcpHostAllow: mcpHostAllowFromEnv(envBag(), desk.mcpUserHosts),
    cliAllow: cliAllowFromEnv(envBag()),
    domain: desk.domain,
    calcs: domainPack().calcs(desk.domain),
    jobs: deskJobs(desk),
    now,
    userText
  };
}

function calcNotice(calc: { ok: boolean; detail?: unknown }): string {
  const detail = calc.detail;
  const reason = detail && typeof detail === "object" && "reason" in detail ? detail.reason : undefined;
  const name = detail && typeof detail === "object" && "name" in detail && typeof detail.name === "string" ? detail.name : "";
  if (!calc.ok) return typeof reason === "string" ? reason : "計算は実行できなかった";
  return name ? `${name} を実行した` : "計算を実行した";
}

function jobNotice(entry: { ok: boolean; detail?: unknown }): string {
  if (!entry.ok) return "ジョブは実行できなかった";
  const detail = entry.detail;
  const name = detail && typeof detail === "object" && "name" in detail && typeof detail.name === "string" ? detail.name : "";
  return name ? `${name} を起動した` : "ジョブを起動した";
}

function worldOf(desk: Desk, now: number): FlowWorld {
  return {
    ledger: desk.ledger,
    board: desk.board,
    now,
    posts: desk.posts,
    search: () => [],
    commentary: () => "",
    calcs: domainPack().calcs(desk.domain),
    jobs: deskJobs(desk),
    capHit: false
  };
}
