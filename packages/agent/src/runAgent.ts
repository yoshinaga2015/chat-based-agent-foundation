/**
 * run_agent：外部エージェント委譲。実行先（AgentHost）は配備側が渡す。
 * 作業場所は使い捨ての複製。変更は承認されるまで利用者の書類・リポジトリに反映しない。
 */

import { agentCatalogEntry, type AgentCatalogEntry } from "./agentCatalog";

export const AGENT_RESULT_CHARS = 12_000;
export const AGENT_DIFF_CHARS = 6_000;
export const AGENT_DEFAULT_TIMEOUT_MS = 120_000;
export const AGENT_MAX_TIMEOUT_MS = 300_000;
export const AGENT_MAX_DOCS = 20;

export type AgentWorkspace =
  | { kind: "none" }
  | { kind: "files"; docIds: string[] }
  | { kind: "repo"; repo: string; ref?: string };

/** モデルに見せる、選べる作業場所。 */
export type AgentWorkspaceCatalog = {
  documents: { docId: string; name: string; version: number }[];
  repos: string[];
};

export type AgentRunRequest = {
  agent: string;
  prompt: string;
  workspace: AgentWorkspace;
  timeoutMs: number;
};

export type AgentChange = {
  path: string;
  status: "added" | "modified" | "deleted";
  binary: boolean;
  /** テキストの unified diff。バイナリは無し。 */
  diff?: string;
  bytes?: number;
};

export type AgentRunOk = {
  ok: true;
  result: string;
  exitCode: number;
  costUsd?: number;
  truncated?: boolean;
  /** 変更を保持している実行の id。変更が無ければ無し。 */
  runId?: string;
  changes: AgentChange[];
};

export type AgentRunFail = {
  ok: false;
  reason: string;
  detail?: { constraint: string };
};

export type AgentRunResult = AgentRunOk | AgentRunFail;

export type AgentWriteBackResult =
  | { ok: true; summary: string; url?: string }
  | AgentRunFail;

/** 承認待ちの書き戻し。 */
export type PendingAgentWrite = {
  runId: string;
  agent: string;
  workspace: Exclude<AgentWorkspace, { kind: "none" }>;
  changes: AgentChange[];
  result: string;
  label: string;
};

export type AgentHost = {
  workspaces(): Promise<AgentWorkspaceCatalog>;
  run(request: AgentRunRequest): Promise<AgentRunResult>;
  writeBack(pending: PendingAgentWrite): Promise<AgentWriteBackResult>;
  discard(runId: string): Promise<void>;
};

export type RunAgentEnv = {
  agentAllow: readonly string[];
  agentHost?: AgentHost;
  planPending: boolean;
  planText: string | null;
  pendingDelete: unknown;
  pendingMcp: unknown;
  pendingAgentWrite: PendingAgentWrite | null;
};

export type RunAgentDraft = {
  planText: string | null;
  pendingAgentWrite: PendingAgentWrite | null;
  ledger?: { planPending: boolean };
};

function normalizeTimeout(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return AGENT_DEFAULT_TIMEOUT_MS;
  return Math.min(AGENT_MAX_TIMEOUT_MS, Math.max(5_000, Math.floor(raw)));
}

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REF_PATTERN = /^[A-Za-z0-9_./-]{1,200}$/;

function parseWorkspace(raw: unknown): { ok: true; workspace: AgentWorkspace } | { ok: false; constraint: string } {
  if (raw === undefined || raw === null) return { ok: true, workspace: { kind: "none" } };
  if (typeof raw !== "object") return { ok: false, constraint: "workspace が不正" };
  const row = raw as Record<string, unknown>;
  if (row.kind === undefined || row.kind === "none") return { ok: true, workspace: { kind: "none" } };
  if (row.kind === "files") {
    const ids = Array.isArray(row.docIds) ? row.docIds.filter((id): id is string => typeof id === "string" && id.trim() !== "") : [];
    const docIds = [...new Set(ids.map((id) => id.trim()))];
    if (docIds.length === 0) return { ok: false, constraint: "workspace.docIds が要る" };
    if (docIds.length > AGENT_MAX_DOCS) return { ok: false, constraint: `書類は${AGENT_MAX_DOCS}件まで` };
    return { ok: true, workspace: { kind: "files", docIds } };
  }
  if (row.kind === "repo") {
    const repo = typeof row.repo === "string" ? row.repo.trim() : "";
    if (!REPO_PATTERN.test(repo)) return { ok: false, constraint: "workspace.repo は owner/name" };
    const ref = typeof row.ref === "string" && row.ref.trim() ? row.ref.trim() : undefined;
    if (ref && (!REF_PATTERN.test(ref) || ref.includes(".."))) return { ok: false, constraint: "workspace.ref が不正" };
    return { ok: true, workspace: ref ? { kind: "repo", repo, ref } : { kind: "repo", repo } };
  }
  return { ok: false, constraint: "workspace.kind は none / files / repo" };
}

export function parseAgentRunArgs(args: unknown):
  | { ok: true; request: AgentRunRequest; entry: AgentCatalogEntry }
  | { ok: false; constraint: string } {
  if (!args || typeof args !== "object") {
    return { ok: false, constraint: "agent と prompt が要る" };
  }
  const row = args as Record<string, unknown>;
  const agent = typeof row.agent === "string" ? row.agent.trim() : "";
  const prompt = typeof row.prompt === "string" ? row.prompt.trim() : "";
  if (!agent) return { ok: false, constraint: "agent が要る" };
  if (!prompt || prompt.length < 4) return { ok: false, constraint: "prompt は4字以上" };
  if (prompt.length > 8_000) return { ok: false, constraint: "prompt が長すぎる" };
  const entry = agentCatalogEntry(agent);
  if (!entry) return { ok: false, constraint: `未知の agent: ${agent}` };
  const workspace = parseWorkspace(row.workspace);
  if (!workspace.ok) return workspace;
  return {
    ok: true,
    entry,
    request: {
      agent: entry.id,
      prompt,
      workspace: workspace.workspace,
      timeoutMs: normalizeTimeout(row.timeoutMs)
    }
  };
}

export function truncateAgentText(text: string, max = AGENT_RESULT_CHARS): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max), truncated: true };
}

export function workspaceLabel(workspace: AgentWorkspace): string {
  if (workspace.kind === "repo") return workspace.ref ? `${workspace.repo}@${workspace.ref}` : workspace.repo;
  if (workspace.kind === "files") return `書類 ${workspace.docIds.length}件`;
  return "作業場所なし";
}

export async function runAgentTool(
  state: RunAgentEnv,
  draft: RunAgentDraft,
  args: unknown
): Promise<unknown> {
  const parsed = parseAgentRunArgs(args);
  if (!parsed.ok) {
    return { ok: false, reason: "invalid_value", detail: { constraint: parsed.constraint } };
  }
  if (!state.agentAllow.includes(parsed.entry.id)) {
    return { ok: false, reason: "agent_denied", detail: { constraint: `${parsed.entry.id} は許可リスト外` } };
  }
  if (state.planPending || draft.planText || state.pendingDelete || state.pendingMcp || state.pendingAgentWrite) {
    return { ok: false, reason: "plan_pending", detail: { constraint: "別の承認待ちがある" } };
  }
  if (!state.agentHost) {
    return { ok: false, reason: "agent_unavailable", detail: { constraint: "外部エージェントの実行先がこの配備に無い" } };
  }

  const outcome = await state.agentHost.run(parsed.request);
  if (!outcome.ok) return outcome;
  const cut = truncateAgentText(outcome.result);
  const workspace = parsed.request.workspace;
  const changes = outcome.changes.map((change) => ({ path: change.path, status: change.status }));
  if (workspace.kind !== "none" && outcome.runId && outcome.changes.length > 0) {
    const pending: PendingAgentWrite = {
      runId: outcome.runId,
      agent: parsed.entry.id,
      workspace,
      changes: outcome.changes,
      result: cut.text.slice(0, 2_000),
      label: `${parsed.entry.name} の変更を ${workspaceLabel(workspace)} に書き戻す（要承認）`
    };
    draft.pendingAgentWrite = pending;
    draft.planText = pending.label;
    if (draft.ledger) draft.ledger.planPending = true;
    return {
      ok: true,
      result: cut.text,
      truncated: Boolean(cut.truncated || outcome.truncated),
      ...(outcome.costUsd !== undefined ? { costUsd: outcome.costUsd } : {}),
      changes,
      plan_pending: true,
      note: "変更は承認されるまで書き戻さない"
    };
  }
  return {
    ok: true,
    result: cut.text,
    truncated: Boolean(cut.truncated || outcome.truncated),
    exitCode: outcome.exitCode,
    ...(outcome.costUsd !== undefined ? { costUsd: outcome.costUsd } : {}),
    changes
  };
}

export async function resolvePendingAgentWrite(
  pending: PendingAgentWrite,
  decision: "approve" | "reject",
  host: AgentHost | undefined
): Promise<{ ok: true; notice: string } | { ok: false; notice: string }> {
  if (!host) return { ok: false, notice: "外部エージェントの実行先がこの配備に無い" };
  if (decision === "reject") {
    await host.discard(pending.runId);
    return { ok: true, notice: "変更を捨てた。書類・リポジトリは元のまま。" };
  }
  const written = await host.writeBack(pending);
  if (!written.ok) {
    const why = written.detail?.constraint ?? written.reason;
    return { ok: false, notice: `書き戻しに失敗した（${why}）` };
  }
  return { ok: true, notice: written.url ? `${written.summary} ${written.url}` : written.summary };
}

/** 実行先が claude に渡す argv（シェル無し）。認証は ANTHROPIC_API_KEY のみ（--bare）。 */
export function claudePrintArgv(request: AgentRunRequest, maxBudgetUsd: number): string[] {
  const prompt =
    request.workspace.kind === "none"
      ? `${request.prompt}\n\n（制約: 作業場所は無い。ファイルを作らない。読み取りと説明のみ。）`
      : `${request.prompt}\n\n（作業場所: /workspace。成果物だけを /workspace に残し、作業用の一時ファイルは /tmp に置く。外部サイトには出られない。）`;
  return [
    "claude",
    "--bare",
    "--print",
    "--output-format",
    "json",
    "--no-session-persistence",
    "--permission-mode",
    "bypassPermissions",
    "--max-budget-usd",
    String(maxBudgetUsd),
    "--",
    prompt
  ];
}

/** `--output-format json` の stdout から最終文を取る。 */
export function parseClaudePrintStdout(stdout: string):
  | { ok: true; result: string; costUsd?: number }
  | { ok: false; reason: string; result: string } {
  const trimmed = stdout.trim();
  if (!trimmed) return { ok: false, reason: "empty_output", result: "" };
  let row: { result?: unknown; total_cost_usd?: unknown; cost_usd?: unknown; is_error?: unknown; subtype?: unknown };
  try {
    row = JSON.parse(trimmed) as typeof row;
  } catch {
    return { ok: false, reason: "unparsable_output", result: trimmed.slice(0, 2_000) };
  }
  const cost = typeof row.total_cost_usd === "number"
    ? row.total_cost_usd
    : typeof row.cost_usd === "number"
      ? row.cost_usd
      : undefined;
  const result = typeof row.result === "string" ? row.result : "";
  if (row.is_error === true) {
    return { ok: false, reason: typeof row.subtype === "string" ? row.subtype : "agent_error", result };
  }
  return { ok: true, result, ...(cost !== undefined ? { costUsd: cost } : {}) };
}
