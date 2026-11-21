// 1ターン。書き込みは末尾まで保留し、割り込みは捨て、時間切れは検証済みだけ確定する。
import { domainPack, type DomainRecordOp } from "./domain";
import { numberTokens } from "./grounding";
import { reviewAnswer } from "./answer";
import { FINAL_REPORT_NUDGE, pickFinalReply } from "./finalizeReply";
import { userContentWithAttachments, type SpeakAttachment } from "./attach";
import type { ChatComplete, ChatMessage, ChatToolCall } from "./chat";
import { applyCardChange, emptyBoard, sourceValues, boardContext, type Board } from "./kanban";
import {
  commitWrites,
  fieldCatalog,
  type CommitResult,
  type FieldChange,
  type Ledger,
  type WriteOp
} from "./ledger";
import {
  BROWSER_FETCH_PER_TURN,
  BROWSER_RENDER_PER_TURN,
  DAILY_TOKEN_CAP,
  MAX_TOOL_CALLS,
  TOKEN_CAP_MESSAGE,
  TOOL_RESULT_CHARS,
  TOOL_TIMEOUT_MS,
  TURN_LIMIT_MS,
  WEB_SEARCH_PER_TURN
} from "./limits";
import { buildResearchPersistGuidance, hostnameOf } from "./researchGuidance";
import {
  assertFetchHost,
  buildGapQueryGuidance,
  classifyResearchQuery,
  evaluateCoverage,
  formatFailureLedger,
  researchBudgetExhausted,
  unusedCandidateHostCount,
  type FailureLedgerEntry,
  type ResearchQueryClass
} from "./researchControl";
import { productRenderedRead } from "./browserRendered";
import type { WebFact } from "./webFacts";
import type { Registries } from "./registry";
import {
  mergeSkillPackage,
  resolveSkillResource,
  skillDiscoveryLine,
  skillPackageFromLegacy,
  type SkillPackage
} from "./agentSkills";
import { BUNDLED_SKILL_PACKAGES, bundledSkillShelf } from "./bundledSkills";
import { normalizeSkillFiles, saveUserSkill, type UserSkill } from "./skills";
import { runCode } from "./sandbox";
import { enrichSearchHitsWithOg } from "./ogEnrich";
import { answerLinks, webSearch, webSearchAsync, type SearchAdapter, type SearchHit } from "./search";
import {
  applyPendingDelete,
  findPendingDeleteTarget,
  isPendingDeleteKind,
  labelPendingDelete,
  type PendingDelete
} from "./pending-delete";
import type { CliRunner, CliRunResult } from "./cli";
import type { McpServer, McpTransport, PendingMcp } from "./mcp";
import {
  cliAllowFromEnv,
  mcpCallTool,
  mcpConfigureTool,
  mcpHostAllowFromEnv,
  mcpListToolsTool,
  runCliTool
} from "./mcp-cli-tools";
import { agentAllowFromEnv } from "./agentCatalog";
import { runAgentTool, type AgentHost, type PendingAgentWrite } from "./runAgent";
import type { Workflow } from "./workflow";
import { runAgentToolDef, systemPrompt, toolDefs } from "./toolDefs";
import { beginToolProgress, finishToolProgress, type ToolProgress } from "./activity";
import { resolvePlaces } from "./places";
import { resolveRoute } from "./route";
import {
  presentChecklistTool,
  presentDraftTool
} from "./presentSurfaces";
import {
  isDelegateAllowedTool,
  parseDelegateTasks,
  runDelegateTasks
} from "./delegate";
import { buildResearchProgress } from "./researchProgress";
import {
  mapToolToUiParts,
  mergeUiParts,
  resolveExclusivePresentSurfaces,
  stampUiParts,
  type UiPart
} from "./uiParts";
import {
  browserFetch,
  browserHostAllowFromEnv,
  type BrowserFetchAdapter
} from "./browser";
import { extractWebFacts } from "./webFacts";
import {
  browserClick,
  browserClose,
  browserNavigate,
  browserRequestHandoff,
  browserScroll,
  browserSelect,
  handoffTaskText,
  isHandoffTaskEcho,
  isBrowserUnreachableConstraint,
  browserSnapshot,
  browserType,
  type BrowserSession,
  type PendingBrowserHandoff
} from "./browserSession";

export type { ToolProgress };

export interface SkillDoc {
  description: string;
  body: string;
  files?: Record<string, string>;
}

export interface ToolCall {
  name: string;
  args: unknown;
}

export interface ModelStep {
  text?: string;
  calls?: ToolCall[];
}

export interface OperationRecord {
  ok: boolean;
  reason: "committed" | "interrupted" | "timeout" | "token_cap" | "invalid_value" | "plan_pending" | "record_not_found" | "field_unknown";
  detail?: unknown;
  changes?: FieldChange[];
}

export interface TurnResult {
  ledger: Ledger;
  text: string;
  unconfirmed: { value: number }[];
  links: { url: string; active: boolean }[];
  operation: OperationRecord;
  toolLog: unknown[];
  /** Generative UI Phase 1。assistant 行へ載せる面。 */
  uiParts: UiPart[];
  blocked: boolean;
  board: Board;
  skills: Readonly<Record<string, UserSkill>>;
  codeMarks: number[];
  pendingPlan: string | null;
  /** 承認後に適用する削除（チャット HITL）。 */
  pendingDelete: PendingDelete | null;
  /** 承認後に適用する MCP 設定変更（チャット HITL）。 */
  pendingMcp: PendingMcp | null;
  /** 承認後に実行する外部エージェント書き込み。 */
  pendingAgentWrite: PendingAgentWrite | null;
  /** ユーザーがブラウザを操作中（Live View）。セッションは close しない。 */
  pendingBrowserHandoff: PendingBrowserHandoff | null;
  workflows: Workflow[];
  mcpServers: McpServer[];
  /** ドメインのパックの状態。書き込みが確定したときだけ変わる。 */
  domain?: unknown;
  /** 当ターンでプロバイダが報告したトークン合計。 */
  tokensUsed: number;
}

export interface TurnInput {
  ledger: Ledger;
  now: number;
  userText: string;
  steps: readonly ModelStep[];
  skills?: Readonly<Record<string, SkillDoc>>;
  board?: Board;
  userSkills?: Readonly<Record<string, UserSkill>>;
  domain?: unknown;
  calcs?: ReadonlyMap<string, (input: unknown) => unknown>;
  jobs?: ReadonlyMap<string, (input: unknown) => { ok: boolean; reason?: string }>;
  toolElapsedMs?: number;
  search?: SearchAdapter;
  /** 公開ページの Markdown 取得（Browser Run 等）。 */
  browser?: BrowserFetchAdapter;
  /** 静的失敗時の動的レンダリング精読（未指定なら env から productRenderedRead）。 */
  browserRendered?: BrowserFetchAdapter;
  /** ブラウザ操作セッション（ローカル Playwright 等）。handoff 待ち以外はターン終了で close。 */
  browserSession?: BrowserSession;
  /** 前ターンからセッションが開いたまま（handoff 完了後の再開など）。 */
  browserOpened?: boolean;
  /** 既存の handoff 待ち（ターン開始時）。閉じずに引き継ぐ。 */
  pendingBrowserHandoff?: PendingBrowserHandoff | null;
  /** 共有ブラウザを別スレッドが人へ渡している。操作も close もしない。 */
  browserHeldElsewhere?: boolean;
  browserHostAllow?: readonly string[];
  rewrite?: (draft: string) => string;
  stopAfter?: { index: number; reason: "interrupt" | "timeout" };
  tokensToday?: number;
  /** `null` は上限なし。未指定は `DAILY_TOKEN_CAP`。 */
  tokenCap?: number | null;
  maxToolCalls?: number;
  elapsedMs?: number;
  jev?: (plan: string) => boolean | "down" | Promise<boolean | "down">;
  registries?: Registries;
  system?: string;
  history?: ChatMessage[];
  /** 当ターンだけモデルへ渡す添付。履歴には載せない。 */
  attachments?: readonly SpeakAttachment[];
  /** 画面／Undo など、チャット HITL を経由しない削除・MCP 設定。 */
  allowDestructive?: boolean;
  /** ワークフロー一覧（削除対象の照合と画面状態）。 */
  workflows?: readonly Workflow[];
  mcpServers?: readonly McpServer[];
  mcpHostAllow?: readonly string[];
  mcpUserHosts?: readonly string[];
  cliAllow?: readonly string[];
  agentAllow?: readonly string[];
  /** 試験用の同期 CLI。 */
  cli?: (argv: string[]) => CliRunResult;
  cliRunner?: CliRunner;
  agentHost?: AgentHost;
  mcp?: McpTransport;
  /** 1 以上なら子委任ターン（再委任・危険 tool 禁止）。 */
  delegateDepth?: number;
}

export type LiveTurnInput = Omit<TurnInput, "steps"> & {
  complete: ChatComplete;
  onTool?: (event: ToolProgress) => void;
};

interface Draft {
  ledger: Ledger;
  ops: WriteOp[];
  rejected: Extract<CommitResult, { ok: false }> | null;
  planText: string | null;
  pendingDelete: PendingDelete | null;
  pendingMcp: PendingMcp | null;
  pendingAgentWrite: PendingAgentWrite | null;
  pendingBrowserHandoff: PendingBrowserHandoff | null;
  urls: string[];
  sources: number[];
  toolLog: unknown[];
  uiParts: UiPart[];
  searches: number;
  browserFetches: number;
  renderedFetches: number;
  /** 精読を試みたホスト（成功・壁・使えぬ本文含む）。分散誘導用。 */
  fetchHosts: string[];
  fetchSuccessByHost: Record<string, number>;
  failedHosts: string[];
  failureLedger: FailureLedgerEntry[];
  factLedger: (WebFact & { sourceUrl: string })[];
  researchClass: ResearchQueryClass;
  /** 成功した delegate_tasks の子件数（合計）。 */
  delegates: number;
  browserActs: number;
  browserOpened: boolean;
  /** このターンで到達不能（timeout/522/ERR_）を一度でも見た。handoff ではなく本文案内。 */
  browserUnreachable: boolean;
  board: Board;
  skills: Record<string, UserSkill>;
  /** Agent Skills パッケージ（同梱＋レガシー変換）。 */
  skillPackages: Record<string, SkillPackage>;
  workflows: Workflow[];
  mcpServers: McpServer[];
  mcpUserHosts: string[];
  codeMarks: number[];
  openedBoard: Board;
  openedSkills: Readonly<Record<string, UserSkill>>;
  domainOps: DomainRecordOp[];
}

export function runTurn(input: TurnInput): TurnResult {
  const cap = input.tokenCap !== undefined ? input.tokenCap : DAILY_TOKEN_CAP;
  const openedBoard = input.board ?? emptyBoard();
  const openedSkills = input.userSkills ?? {};
  if (cap != null && (input.tokensToday ?? 0) >= cap) return cappedTurn(input, openedBoard, openedSkills);

  const draft: Draft = openDraft(input, openedBoard, openedSkills);
  const maxCalls = input.maxToolCalls ?? MAX_TOOL_CALLS;
  let calls = 0;

  const timedOut = () => (input.elapsedMs ?? 0) >= TURN_LIMIT_MS;

  if (timedOut()) return closeTurn(input, draft, "timeout");

  for (let i = 0; i < input.steps.length; i++) {
    const step = input.steps[i];
    if (!step) continue;
    for (const call of step.calls ?? []) {
      if (calls >= maxCalls || timedOut()) return closeTurn(input, draft, "timeout");
      calls += 1;
      const result = runTool(input, draft, call);
      draft.toolLog.push(result);
      draft.uiParts.push(...mapToolToUiParts(call.name, call.args, result));
    }
    if (input.stopAfter?.index === i) return closeTurn(input, draft, input.stopAfter.reason === "interrupt" ? "interrupt" : "timeout");
    if (step.text && (step.calls?.length ?? 0) === 0) return closeTurn(input, draft, "commit", step.text);
  }
  return closeTurn(input, draft, "commit", "");
}

/** モデルがテキストを返すまでツールを回し、書き込みは末尾で一括採否する。 */
export async function runLiveTurn(input: LiveTurnInput): Promise<TurnResult> {
  const cap = input.tokenCap !== undefined ? input.tokenCap : DAILY_TOKEN_CAP;
  const openedBoard = input.board ?? emptyBoard();
  const openedSkills = input.userSkills ?? {};
  if (cap != null && (input.tokensToday ?? 0) >= cap) return cappedTurn(input, openedBoard, openedSkills);

  const draft = openDraft(input, openedBoard, openedSkills);
  try {
    const maxCalls = input.maxToolCalls ?? MAX_TOOL_CALLS;
    const started = Date.now();
    const timedOut = () => (input.elapsedMs ?? Date.now() - started) >= TURN_LIMIT_MS;
    let tools = toolDefs(input.registries ?? { calcs: new Set(), jobs: new Set() });
    if (input.agentHost) {
      const catalog = await input.agentHost.workspaces();
      tools = tools.map((def) => (def.function.name === "run_agent" ? runAgentToolDef(catalog) : def));
    } else {
      tools = tools.filter((def) => def.function.name !== "run_agent");
    }
    if ((input.delegateDepth ?? 0) > 0) {
      tools = tools.filter((def) => isDelegateAllowedTool(def.function.name));
    }
    const messages: ChatMessage[] = [
      { role: "system", content: `${input.system ?? systemPrompt()}\n\n${worldBrief(input, draft)}` },
      ...(input.history ?? []),
      { role: "user", content: userContentWithAttachments(input.userText, input.attachments ?? []) }
    ];
    let calls = 0;
    let tokensUsed = 0;

    if (timedOut()) return closeTurn(input, draft, "timeout", "", tokensUsed);

    while (calls < maxCalls) {
      if (timedOut()) return closeTurn(input, draft, "timeout", "", tokensUsed);
      const completion = await input.complete({ messages, tools });
      tokensUsed += Math.max(0, completion.tokens ?? 0);
      if (completion.toolCalls.length > 0) {
        const assistant: ChatMessage = {
          role: "assistant",
          content: completion.content,
          tool_calls: completion.toolCalls
        };
        messages.push(assistant);
        for (const toolCall of completion.toolCalls) {
          if (calls >= maxCalls || timedOut()) return closeTurn(input, draft, "timeout", "", tokensUsed);
          calls += 1;
          const parsed = parseToolCall(toolCall);
          const progress = beginToolProgress(parsed.name, parsed.args, draft.mcpServers);
          input.onTool?.(progress);
          const result = await runToolMaybeAsync(withEmptySteps(input), draft, parsed);
          draft.toolLog.push(result);
          draft.uiParts.push(...mapToolToUiParts(parsed.name, parsed.args, result));
          const preview = await browserPreviewAfter(parsed.name, result, input.browserSession);
          const liveViewUrl = await browserLiveViewAfter(parsed.name, result, input.browserSession);
          input.onTool?.(
            finishToolProgress(progress, result, parsed.args, draft.mcpServers, preview, liveViewUrl)
          );
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: parsed.name,
            content: JSON.stringify(result)
          });
          if (draft.pendingAgentWrite) {
            const spoken = (completion.content ?? "").trim();
            return closeTurn(input, draft, "commit", spoken || draft.pendingAgentWrite.result, tokensUsed);
          }
          if (draft.pendingBrowserHandoff) {
            const task = handoffTaskText(draft.pendingBrowserHandoff);
            const spoken = (completion.content ?? "").trim();
            // task は Banner 側。吹き出しに同じ文を載せない。
            const reply = isHandoffTaskEcho(spoken, task) ? "" : spoken;
            return closeTurn(input, draft, "commit", reply, tokensUsed);
          }
        }
        continue;
      }
      // ツール後に空本文で終わるのはハーネス上の失敗。テキスト専用で一回だけ報告を取り直す。
      const ensured = await ensureUserFacingReply(
        input,
        messages,
        draft,
        completion.content ?? "",
        tokensUsed
      );
      return closeTurn(input, draft, "commit", ensured.text, ensured.tokensUsed);
    }
    return closeTurn(
      input,
      draft,
      "timeout",
      pickFinalReply("ツール呼び出しの上限に達したため、ここまでの結果で止めます。", draft.toolLog),
      tokensUsed
    );
  } finally {
    // handoff 待ちは同一セッションをユーザー操作に渡すため閉じない
    if (input.browserSession && !draft.pendingBrowserHandoff && !input.browserHeldElsewhere) {
      await input.browserSession.close().catch(() => undefined);
    }
  }
}

async function ensureUserFacingReply(
  input: LiveTurnInput,
  messages: ChatMessage[],
  draft: Draft,
  raw: string,
  tokensUsed: number
): Promise<{ text: string; tokensUsed: number }> {
  const trimmed = raw.trim();
  if (trimmed) return { text: trimmed, tokensUsed };
  if (draft.toolLog.length === 0) return { text: "", tokensUsed };

  messages.push({ role: "user", content: FINAL_REPORT_NUDGE });
  const recovery = await input.complete({ messages, tools: [] });
  const nextTokens = tokensUsed + Math.max(0, recovery.tokens ?? 0);
  const recovered = (recovery.content ?? "").trim();
  if (recovered) return { text: recovered, tokensUsed: nextTokens };
  return { text: pickFinalReply("", draft.toolLog), tokensUsed: nextTokens };
}

const BROWSER_PREVIEW_TOOLS = new Set([
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_scroll",
  "browser_select"
]);

async function browserPreviewAfter(
  name: string,
  result: unknown,
  session: BrowserSession | undefined
): Promise<ToolProgress["preview"] | undefined> {
  if (!session) return undefined;
  if (!BROWSER_PREVIEW_TOOLS.has(name)) return undefined;
  const ok = !(result && typeof result === "object" && "ok" in result && result.ok === false);
  if (!ok) return undefined;
  const shot = await session.screenshot().catch(() => null);
  return shot ?? undefined;
}

async function browserLiveViewAfter(
  name: string,
  result: unknown,
  session: BrowserSession | undefined
): Promise<string | undefined> {
  if (!session) return undefined;
  if (!BROWSER_PREVIEW_TOOLS.has(name)) return undefined;
  const ok = !(result && typeof result === "object" && "ok" in result && result.ok === false);
  if (!ok) return undefined;
  const refreshed = (await session.refreshLiveViewUrl().catch(() => null))?.trim() ?? "";
  const url = refreshed || session.liveViewUrl()?.trim() || "";
  return url || undefined;
}

function openDraft(input: TurnInput | LiveTurnInput, openedBoard: Board, openedSkills: Readonly<Record<string, UserSkill>>): Draft {
  return {
    ledger: input.ledger,
    ops: [],
    rejected: null,
    planText: null,
    pendingDelete: null,
    pendingMcp: null,
    pendingAgentWrite: null,
    pendingBrowserHandoff: input.pendingBrowserHandoff ?? null,
    urls: [],
    sources: numberTokens(input.userText).map((token) => token.value),
    toolLog: [],
    uiParts: [],
    searches: 0,
    browserFetches: 0,
    renderedFetches: 0,
    fetchHosts: [],
    fetchSuccessByHost: {},
    failedHosts: [],
    failureLedger: [],
    factLedger: [],
    researchClass: classifyResearchQuery(input.userText),
    delegates: 0,
    browserActs: 0,
    browserOpened: input.browserOpened === true || Boolean(input.pendingBrowserHandoff),
    browserUnreachable: false,
    board: openedBoard,
    skills: { ...bundledSkillShelf(), ...copyShelf(input.skills), ...openedSkills },
    skillPackages: buildSkillPackages(copyShelf(input.skills), openedSkills),
    workflows: [...(input.workflows ?? [])],
    mcpServers: [...(input.mcpServers ?? [])],
    mcpUserHosts: [...(input.mcpUserHosts ?? [])],
    codeMarks: [],
    openedBoard,
    openedSkills,
    domainOps: []
  };
}

function cappedTurn(input: TurnInput | LiveTurnInput, board: Board, skills: Readonly<Record<string, UserSkill>>): TurnResult {
  return {
    ledger: input.ledger,
    text: TOKEN_CAP_MESSAGE,
    unconfirmed: [],
    links: [],
    operation: { ok: false, reason: "token_cap", detail: TOKEN_CAP_MESSAGE },
    toolLog: [],
    uiParts: [],
    blocked: true,
    board,
    skills,
    codeMarks: [],
    pendingPlan: null,
    pendingDelete: null,
    pendingMcp: null,
    pendingAgentWrite: null,
    pendingBrowserHandoff: null,
    workflows: [...(input.workflows ?? [])],
    mcpServers: [...(input.mcpServers ?? [])],
    domain: input.domain,
    tokensUsed: 0
  };
}

function parseToolCall(toolCall: ChatToolCall): ToolCall {
  let args: unknown = {};
  try {
    args = JSON.parse(toolCall.function.arguments || "{}");
  } catch {
    args = {};
  }
  return { name: toolCall.function.name, args };
}

function withEmptySteps(input: LiveTurnInput): TurnInput {
  return { ...input, steps: [] };
}

function worldBrief(input: LiveTurnInput, draft: Draft): string {
  const cards = [...draft.board.cards]
    .filter(([, card]) => card.deletedAt === null)
    .map(([id, card]) => `${id}「${card.title}」/${card.state}`);
  const skillLines = Object.values(draft.skillPackages).map(skillDiscoveryLine);
  const notes = [...draft.ledger.notes]
    .filter(([, note]) => note.deletedAt === null)
    .map(([id, note]) => `${id}「${note.title || "無題"}」`);
  const memos = [...draft.ledger.memos.keys()].map((id) => id);
  const flows = draft.workflows.map((flow) => `${flow.id}「${flow.name}」`);
  const jobs = input.jobs ? [...input.jobs.keys()] : [];
  const lines = [
    "【現在の画面状態】",
    `実行計画の承認待ち: ${input.ledger.planPending ? "はい" : "いいえ"}`,
    `ノート: ${notes.length > 0 ? notes.join("、") : "なし"}`,
    `メモ: ${memos.length > 0 ? memos.join("、") : "なし"}`,
    `カンバン: ${cards.length > 0 ? cards.join("、") : "空"}`,
    `スキル: ${skillLines.length > 0 ? skillLines.join("、") : "なし"}`,
    `ワークフロー（削除できる自動化）: ${flows.length > 0 ? flows.join("、") : "なし"}`,
    `登録ジョブ（削除不可・起動のみ）: ${jobs.length > 0 ? jobs.join("、") : "なし"}`,
    "時計は日付を進める操作であり、削除対象ではない。"
  ];
  if (draft.pendingBrowserHandoff) {
    lines.push(
      "【ブラウザ】ユーザー引き継ぎ待ち。追加の browser 操作はしない。完了ボタン待ち。"
    );
  } else if (input.browserHeldElsewhere) {
    lines.push(
      "【ブラウザ】別スレッドがブラウザをユーザーに引き継ぎ中。browser_* 操作はできない（browser_fetch は可）。必要ならそのスレッドで完了かやめるを押すよう伝える。"
    );
  } else if (userAsksBrowserHandoff(input.userText)) {
    lines.push(
      "【ブラウザ】ユーザーが操作の引き継ぎを求めている。開いていなければ browser_navigate で対象を開き、すぐ browser_request_handoff（task に具体と完了条件）。文言だけで渡したと言わない。"
    );
  } else if (draft.browserOpened) {
    lines.push(
      "【ブラウザ】セッション開いている。ログイン等でユーザー操作が要るときだけ browser_request_handoff（task 必須）。画像取得失敗だけでは渡さない。"
    );
  }
  return lines.join("\n");
}

function userAsksBrowserHandoff(text: string): boolean {
  return /引き継|引継|自分で操作|渡して|渡そう|handoff|テイクオーバー|take\s*over/i.test(text);
}

function closeTurn(
  input: TurnInput | LiveTurnInput,
  draft: Draft,
  how: "commit" | "interrupt" | "timeout",
  rawText = "",
  tokensUsed = 0
): TurnResult {
  const coverage = evaluateCoverage({
    queryClass: draft.researchClass,
    facts: draft.factLedger,
    successHosts: Object.keys(draft.fetchSuccessByHost)
  });
  const unusedHosts = unusedCandidateHostCount({
    candidateUrls: draft.urls,
    triedHosts: draft.fetchHosts
  });
  const exhausted = researchBudgetExhausted({
    searches: draft.searches,
    searchMax: WEB_SEARCH_PER_TURN,
    fetches: draft.browserFetches,
    fetchMax: BROWSER_FETCH_PER_TURN,
    unusedCandidateHosts: unusedHosts
  });
  const merged = mergeUiParts(
    resolveExclusivePresentSurfaces(draft.uiParts, {
      userText: input.userText,
      parallelJobs: draft.delegates > 0
    })
  );
  const research = buildResearchProgress({
    searches: draft.searches,
    browserFetches: draft.browserFetches,
    delegates: draft.delegates,
    hasFetchSources: draft.uiParts.some(
      (part) => part.kind === "sources" && part.sourceTool === "browser_fetch"
    ),
    hasFacts: draft.uiParts.some((part) => part.kind === "fact_rows") || draft.factLedger.length > 0,
    coverageMet: coverage.met,
    budgetExhausted: exhausted
  });
  const uiParts = research
    ? mergeUiParts([
        ...merged,
        ...stampUiParts([research], {
          sourceTool: "research_progress",
          producedAt: Date.now(),
          audience: "internal"
        })
      ])
    : merged;
  const text = rawText;
  const base = {
    workflows: draft.workflows,
    mcpServers: draft.mcpServers,
    domain: input.domain,
    tokensUsed,
    uiParts
  };
  if (how === "interrupt") {
    return {
      ledger: input.ledger,
      text,
      unconfirmed: [],
      links: [],
      operation: { ok: false, reason: "interrupted", detail: "割り込みにより、保留中の変更を破棄した" },
      toolLog: draft.toolLog,
      blocked: false,
      board: draft.openedBoard,
      skills: draft.openedSkills,
      codeMarks: [],
      pendingPlan: null,
      pendingDelete: null,
      pendingMcp: null,
      pendingAgentWrite: null,
      pendingBrowserHandoff: null,
      ...base
    };
  }
  if (draft.rejected && draft.ops.length === 0 && draft.domainOps.length === 0) {
    return {
      ledger: input.ledger,
      text,
      unconfirmed: [],
      links: answerLinks(text, draft.urls),
      operation: { ok: false, reason: draft.rejected.reason, detail: draft.rejected.detail },
      toolLog: draft.toolLog,
      blocked: false,
      board: draft.openedBoard,
      skills: draft.openedSkills,
      codeMarks: draft.codeMarks,
      pendingPlan: null,
      pendingDelete: null,
      pendingMcp: null,
      pendingAgentWrite: null,
      pendingBrowserHandoff: draft.pendingBrowserHandoff,
      ...base
    };
  }
  const records = domainPack().records;
  const domainCommit = records && draft.domainOps.length > 0
    ? records.commit(input.domain, draft.domainOps, input.ledger.planPending)
    : null;
  if (domainCommit && !domainCommit.ok) {
    return {
      ledger: input.ledger,
      text,
      unconfirmed: [],
      links: answerLinks(text, draft.urls),
      operation: { ok: false, reason: domainCommit.reason, detail: domainCommit.detail },
      toolLog: draft.toolLog,
      blocked: false,
      board: draft.openedBoard,
      skills: draft.openedSkills,
      codeMarks: draft.codeMarks,
      pendingPlan: null,
      pendingDelete: null,
      pendingMcp: null,
      pendingAgentWrite: null,
      pendingBrowserHandoff: draft.pendingBrowserHandoff,
      ...base
    };
  }
  const committed = commitWrites(input.ledger, draft.ops, input.now);
  const ledger = committed.ok ? withPlan(committed.ledger, draft.planText) : input.ledger;
  const reviewed = text
    ? reviewAnswer({
        draft: text,
        sources: draft.sources,
        rewrite: (current) => input.rewrite?.(current) ?? current
      })
    : { text: "", unconfirmed: [] };
  const operation: OperationRecord = committed.ok
    ? {
        ok: true,
        reason: how === "timeout" ? "timeout" : "committed",
        detail: how === "timeout" ? "時間切れのため、検証を通った保留を確定した" : undefined,
        changes: committed.changes
      }
    : { ok: false, reason: committed.reason, detail: committed.detail };
  const handoff = draft.pendingBrowserHandoff;
  const planPending = committed.ok && Boolean(draft.planText) && !handoff;
  return {
    ledger: planPending ? ledger : committed.ok ? { ...ledger, planPending: false } : ledger,
    text: reviewed.text,
    unconfirmed: reviewed.unconfirmed.map((token) => ({ value: token.value })),
    links: answerLinks(reviewed.text, draft.urls),
    operation,
    toolLog: draft.toolLog,
    blocked: false,
    board: draft.board,
    skills: draft.skills,
    codeMarks: draft.codeMarks,
    pendingPlan: planPending ? draft.planText : null,
    pendingDelete: planPending ? draft.pendingDelete : null,
    pendingMcp: planPending ? draft.pendingMcp : null,
    pendingAgentWrite: planPending ? draft.pendingAgentWrite : null,
    pendingBrowserHandoff: handoff,
    workflows: draft.workflows,
    mcpServers: draft.mcpServers,
    domain: committed.ok && domainCommit?.ok ? domainCommit.state : input.domain,
    tokensUsed,
    uiParts
  };
}

function withPlan(ledger: Ledger, planText: string | null): Ledger {
  if (!planText) return ledger;
  return { ...ledger, planPending: true };
}

async function runToolMaybeAsync(input: TurnInput, draft: Draft, call: ToolCall): Promise<unknown> {
  if (call.name === "delegate_tasks") return delegateTasksAsync(input, draft, call.args);
  if (call.name === "web_search") return searchAsync(input, draft, call.args);
  if (call.name === "resolve_route") return resolveRouteAsync(call.args);
  if (call.name === "browser_fetch") return browserFetchAsync(input, draft, call.args);
  if (
    call.name === "browser_navigate" ||
    call.name === "browser_snapshot" ||
    call.name === "browser_click" ||
    call.name === "browser_type" ||
    call.name === "browser_scroll" ||
    call.name === "browser_select" ||
    call.name === "browser_close" ||
    call.name === "browser_request_handoff"
  ) {
    return browserActAsync(input, draft, call);
  }
  if (call.name === "propose_plan") return proposePlanAsync(input, draft, call.args);
  if (
    call.name === "run_cli" ||
    call.name === "run_agent" ||
    call.name === "mcp_list_tools" ||
    call.name === "mcp_call"
  ) {
    return runToolAsync(input, draft, call);
  }
  return runTool(input, draft, call);
}

function envBag(): Record<string, string | undefined> {
  try {
    return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  } catch {
    return {};
  }
}

function mcpCliState(input: TurnInput, draft: Draft) {
  const userHosts = draft.mcpUserHosts;
  return {
    mcpServers: draft.mcpServers,
    mcpHostAllow: input.mcpHostAllow ?? mcpHostAllowFromEnv(envBag(), userHosts),
    mcpUserHosts: userHosts,
    cliAllow: input.cliAllow ?? cliAllowFromEnv(envBag()),
    pendingMcp: draft.pendingMcp,
    planText: draft.planText,
    pendingDelete: draft.pendingDelete,
    planPending: input.ledger.planPending,
    allowDestructive: input.allowDestructive,
    cli: input.cli,
    cliRunner: input.cliRunner,
    mcp: input.mcp
  };
}

function runAgentState(input: TurnInput, draft: Draft) {
  return {
    agentAllow: input.agentAllow ?? agentAllowFromEnv(envBag()),
    agentHost: input.agentHost,
    planPending: input.ledger.planPending,
    planText: draft.planText,
    pendingDelete: draft.pendingDelete,
    pendingMcp: draft.pendingMcp,
    pendingAgentWrite: draft.pendingAgentWrite
  };
}

async function runToolAsync(input: TurnInput, draft: Draft, call: ToolCall): Promise<unknown> {
  if ((input.toolElapsedMs ?? 0) >= TOOL_TIMEOUT_MS) {
    return { ok: false, reason: "timeout", detail: { constraint: "ツール1回は20秒" } };
  }
  const state = mcpCliState(input, draft);
  if (call.name === "run_cli") return runCliTool(state, call.args);
  if (call.name === "run_agent") {
    return runAgentTool(runAgentState(input, draft), draft, call.args);
  }
  if (call.name === "mcp_list_tools") return mcpListToolsTool(state, call.args);
  if (call.name === "mcp_call") return mcpCallTool(state, call.args);
  return runTool(input, draft, call);
}

function runTool(input: TurnInput, draft: Draft, call: ToolCall): unknown {
  if ((input.toolElapsedMs ?? 0) >= TOOL_TIMEOUT_MS) {
    return { ok: false, reason: "timeout", detail: { constraint: "ツール1回は20秒" } };
  }
  if (call.name === "write_records") return stageWrites(input, draft, call.args);
  if (call.name === "read_records") return readRecords(draft, call.args);
  if (call.name === "activate_skill") return activateSkill(draft, call.args);
  if (call.name === "read_skill_resource") return readSkill(draft, call.args);
  if (call.name === "write_skill_resource") return writeSkillResource(draft, call.args);
  if (call.name === "save_skill") return saveSkill(draft, call.args);
  if (call.name === "kanban_add") return kanbanAdd(input, draft, call.args);
  if (call.name === "kanban_update") return kanbanUpdate(input, draft, call.args);
  if (call.name === "delete_item") return deleteItem(input, draft, call.args);
  if (call.name === "run_code") return code(draft, call.args);
  if (call.name === "run_calc") return registered(input.calcs, call.args);
  if (call.name === "compare_rows") {
    const compare = domainPack().compareRows;
    return compare ? compare(input.domain) : { ok: false, reason: "unknown_tool", detail: { name: call.name } };
  }
  if (call.name === "present_checklist") return presentChecklistTool(call.args);
  if (call.name === "present_draft") return presentDraftTool(call.args);
  if (call.name === "delegate_tasks") {
    return {
      ok: false,
      reason: "async_only",
      detail: { constraint: "delegate_tasks はライブターンで使う" }
    };
  }
  if (call.name === "start_job") return registeredJob(input.jobs, call.args);
  if (call.name === "show") return show(draft, call.args);
  if (call.name === "propose_plan") return proposePlan(input, draft, call.args);
  if (call.name === "web_search") return search(input, draft, call.args);
  if (call.name === "resolve_places") return resolvePlaces(call.args);
  if (call.name === "resolve_route") {
    return {
      ok: false,
      reason: "unavailable",
      detail: { constraint: "resolve_route はライブターンで使う" }
    };
  }
  if (call.name === "browser_fetch") {
    return {
      ok: false,
      reason: "unavailable",
      detail: { constraint: "browser_fetch はライブターンで使う" }
    };
  }
  if (
    call.name === "browser_navigate" ||
    call.name === "browser_snapshot" ||
    call.name === "browser_click" ||
    call.name === "browser_type" ||
    call.name === "browser_scroll" ||
    call.name === "browser_select" ||
    call.name === "browser_close" ||
    call.name === "browser_request_handoff"
  ) {
    return {
      ok: false,
      reason: "unavailable",
      detail: { constraint: "ブラウザ操作はライブターンで使う" }
    };
  }
  if (call.name === "run_cli") {
    const result = runCliTool(mcpCliState(input, draft), call.args);
    return result instanceof Promise ? { ok: false, reason: "cli_unavailable", detail: { constraint: "同期経路では非同期 CLI 不可" } } : result;
  }
  if (call.name === "run_agent") {
    return {
      ok: false,
      reason: "unavailable",
      detail: { constraint: "run_agent はライブターンで使う" }
    };
  }
  if (call.name === "mcp_list_tools" || call.name === "mcp_call") {
    return { ok: false, reason: "mcp_unavailable", detail: { constraint: "同期経路では非同期 MCP 不可。試験は runLiveTurn かモックを使う" } };
  }
  if (call.name === "mcp_configure") {
    return mcpConfigureTool(mcpCliState(input, draft), draft, call.args);
  }
  return { ok: false, reason: "unknown_tool", detail: { name: call.name } };
}

function stageWrites(input: TurnInput, draft: Draft, args: unknown): unknown {
  const parsed = writeOps(args);
  if (!parsed) return { ok: false, reason: "invalid_value", detail: { constraint: "ops に書き込みの配列が要る" } };
  const records = domainPack().records;
  const destructive = parsed.notes.filter((op) => op.delete);
  if (destructive.length > 0 && !input.allowDestructive) {
    return holdDestructiveWrites(input, draft, parsed, destructive);
  }
  const notes = [...draft.ops, ...parsed.notes];
  const domainOps = [...draft.domainOps, ...parsed.domainOps];
  const checked = commitWrites(input.ledger, notes, input.now);
  if (!checked.ok) return rejectWrites(draft, checked);
  if (domainOps.length > 0 && records) {
    const domainChecked = records.commit(input.domain, domainOps, input.ledger.planPending);
    if (!domainChecked.ok) return rejectWrites(draft, domainChecked);
  }
  draft.rejected = null;
  draft.ops = notes;
  draft.domainOps = domainOps;
  return { ok: true, accepted: true, count: parsed.notes.length + parsed.domainOps.length, note: "ターン終了時に台帳へ確定する" };
}

function holdDestructiveWrites(
  input: TurnInput,
  draft: Draft,
  parsed: { notes: WriteOp[]; domainOps: DomainRecordOp[] },
  destructive: WriteOp[]
): unknown {
  if (destructive.length > 1) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "削除は1件ずつ確認する" } };
  }
  if (parsed.notes.some((op) => !op.delete) || parsed.domainOps.length > 0) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "削除と他の書き込みは同じ呼び出しに混ぜない" } };
  }
  const op = destructive[0]!;
  return holdPendingDelete(input, draft, { kind: op.kind, id: op.id });
}

function deleteWorld(input: TurnInput, draft: Draft) {
  return {
    ledger: input.ledger,
    board: draft.board,
    skills: draft.skills,
    workflows: draft.workflows
  };
}

function holdPendingDelete(input: TurnInput, draft: Draft, pending: PendingDelete): unknown {
  if (input.ledger.planPending || draft.planText || draft.pendingDelete || draft.pendingMcp) {
    return { ok: false, reason: "plan_pending", detail: {} };
  }
  const world = deleteWorld(input, draft);
  if (pending.kind === "note") {
    const note = world.ledger.notes.get(pending.id);
    if (note && note.deletedAt !== null) {
      return { ok: true, accepted: true, note: "すでに削除済み" };
    }
  }
  if (pending.kind === "card") {
    const card = world.board.cards.get(pending.id);
    if (card && card.deletedAt !== null) {
      return { ok: true, accepted: true, note: "すでに削除済み" };
    }
  }
  if (!findPendingDeleteTarget(world, pending)) {
    return { ok: false, reason: "record_not_found", detail: { kind: pending.kind, id: pending.id } };
  }
  if (pending.kind === "note" || pending.kind === "thread_memo") {
    const checked = commitWrites(
      { ...input.ledger, planPending: false },
      [{ kind: pending.kind, id: pending.id, delete: true }],
      input.now
    );
    if (!checked.ok) return checked;
  }
  draft.pendingDelete = pending;
  draft.ops = [];
  draft.domainOps = [];
  draft.rejected = null;
  draft.planText = labelPendingDelete(pending, world);
  return {
    ok: true,
    accepted: false,
    reason: "plan_pending",
    note: "削除は承認待ち。フォームで承認してください。"
  };
}

function deleteItem(input: TurnInput, draft: Draft, args: unknown): unknown {
  const record = args && typeof args === "object" ? args : {};
  const kind = "kind" in record ? record.kind : undefined;
  const id = "id" in record && typeof record.id === "string" ? record.id.trim() : "";
  if (!isPendingDeleteKind(kind) || !id) {
    return {
      ok: false,
      reason: "invalid_value",
      detail: { constraint: "kind は note / thread_memo / card / skill / workflow、id が要る" }
    };
  }
  if (kind === "workflow" && (id === "時計" || id === "clock")) {
    return {
      ok: false,
      reason: "invalid_value",
      detail: { constraint: "時計は日付を進める操作であり削除できない。削除できる自動化はワークフロー一覧だけ" }
    };
  }
  if (input.jobs?.has(id)) {
    return {
      ok: false,
      reason: "invalid_value",
      detail: { constraint: "登録ジョブは削除できない。起動のみ" }
    };
  }
  const pending: PendingDelete = { kind, id };
  if (input.allowDestructive) {
    if (pending.kind === "note" || pending.kind === "thread_memo") {
      if (!findPendingDeleteTarget(deleteWorld(input, draft), pending)) {
        return { ok: false, reason: "record_not_found", detail: { kind, id } };
      }
      draft.ops = [...draft.ops, { kind: pending.kind, id: pending.id, delete: true }];
      draft.rejected = null;
      return { ok: true, accepted: true, kind, id, note: "削除した" };
    }
    const applied = applyPendingDelete(deleteWorld(input, draft), pending, input.now);
    if (!applied.ok) return { ok: false, reason: applied.reason, detail: { kind, id } };
    draft.board = applied.board;
    draft.skills = applied.skills;
    draft.workflows = applied.workflows;
    draft.rejected = null;
    return { ok: true, accepted: true, kind, id, note: "削除した" };
  }
  return holdPendingDelete(input, draft, pending);
}

function rejectWrites(draft: Draft, rejected: Extract<CommitResult, { ok: false }>): Extract<CommitResult, { ok: false }> {
  draft.ops = [];
  draft.domainOps = [];
  draft.rejected = rejected;
  return rejected;
}

function writeOps(args: unknown): { notes: WriteOp[]; domainOps: DomainRecordOp[] } | null {
  if (!args || typeof args !== "object" || !("ops" in args) || !Array.isArray(args.ops)) return null;
  const notes: WriteOp[] = [];
  const domainOps: DomainRecordOp[] = [];
  const domainKinds = domainPack().records?.kinds ?? [];
  for (const raw of args.ops) {
    if (!raw || typeof raw !== "object") return null;
    const kind = "kind" in raw ? raw.kind : undefined;
    const id = "id" in raw ? raw.id : undefined;
    if (typeof id !== "string") return null;
    const fields = "fields" in raw && raw.fields && typeof raw.fields === "object" ? raw.fields as Record<string, unknown> : undefined;
    if (typeof kind === "string" && domainKinds.includes(kind)) {
      if (!fields) return null;
      domainOps.push({ kind, id, fields: { ...fields } });
      continue;
    }
    if (kind !== "note" && kind !== "thread_memo") return null;
    const version = "version" in raw && typeof raw.version === "number" ? raw.version : undefined;
    const deleteFlag = "delete" in raw && raw.delete === true;
    const undo = "undo" in raw && raw.undo === true;
    notes.push({ kind, id, fields, version, delete: deleteFlag || undefined, undo: undo || undefined });
  }
  return { notes, domainOps };
}

function readRecords(draft: Draft, args: unknown): unknown {
  if (!args || typeof args !== "object" || !("kind" in args)) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "kind が要る" } };
  }
  const kind = args.kind;
  const id = "id" in args && typeof args.id === "string" ? args.id : undefined;
  if (kind !== "note" && kind !== "thread_memo") {
    return { ok: false, reason: "field_unknown", detail: { editable: ["note", "thread_memo"] } };
  }
  if (!id) {
    const ids = kind === "note"
      ? [...draft.ledger.notes].filter(([, note]) => note.deletedAt === null).map(([noteId, note]) => ({ id: noteId, title: note.title }))
      : [...draft.ledger.memos.keys()].map((memoId) => ({ id: memoId }));
    return cut({ ok: true, records: ids, editable: fieldCatalog(kind) });
  }
  if (kind === "note") {
    const note = draft.ledger.notes.get(id);
    if (!note || note.deletedAt !== null) return { ok: false, reason: "record_not_found", detail: { id } };
    const body = { ok: true, record: { id, title: note.title, body: note.body, value: note.value }, editable: fieldCatalog("note") };
    if (typeof note.value === "number") draft.sources.push(note.value);
    return cut(body);
  }
  const memo = draft.ledger.memos.get(id);
  if (!memo) return { ok: false, reason: "record_not_found", detail: { id } };
  return cut({ ok: true, record: { id, memo_body: memo.body, version: memo.version }, editable: fieldCatalog("thread_memo") });
}

function copyShelf(skills: Readonly<Record<string, SkillDoc>> | undefined): Record<string, UserSkill> {
  const shelf: Record<string, UserSkill> = {};
  for (const [name, skill] of Object.entries(skills ?? {})) {
    const row: UserSkill = { name, description: skill.description, body: skill.body };
    if (skill.files && Object.keys(skill.files).length > 0) row.files = { ...skill.files };
    shelf[name] = row;
  }
  return shelf;
}

function skillDoc(draft: Draft, name: string): UserSkill | undefined {
  return draft.skills[name];
}

function skillPackageOf(draft: Draft, name: string): SkillPackage | undefined {
  return draft.skillPackages[name];
}

function buildSkillPackages(
  shelf: Record<string, UserSkill>,
  opened: Readonly<Record<string, UserSkill>>
): Record<string, SkillPackage> {
  const packages: Record<string, SkillPackage> = { ...BUNDLED_SKILL_PACKAGES };
  for (const skill of Object.values({ ...shelf, ...opened })) {
    // ユーザー／エージェント編集を優先。同梱の resources は merge で残す。
    packages[skill.name] = mergeSkillPackage(packages[skill.name], skill);
  }
  return packages;
}

function activateSkill(draft: Draft, args: unknown): unknown {
  const name = toolName(args);
  if (!name) return { ok: false, reason: "invalid_value", detail: { constraint: "name が要る" } };
  const pkg = skillPackageOf(draft, name);
  if (!pkg) return { ok: false, reason: "record_not_found", detail: { name } };
  // Level 2: SKILL.md 本文。数値は出典にならない。
  return cut({
    ok: true,
    name: pkg.frontmatter.name,
    description: pkg.frontmatter.description,
    instructions: pkg.instructions,
    resources: pkg.resources,
    body: pkg.instructions
  });
}

function readSkill(draft: Draft, args: unknown): unknown {
  const name = toolName(args);
  if (!name) return { ok: false, reason: "invalid_value", detail: { constraint: "name が要る" } };
  const pkg = skillPackageOf(draft, name);
  if (!pkg) return { ok: false, reason: "record_not_found", detail: { name } };
  const path =
    args && typeof args === "object" && "path" in args && typeof (args as { path: unknown }).path === "string"
      ? (args as { path: string }).path
      : undefined;
  const resolved = resolveSkillResource(pkg, path);
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason, detail: { name, path } };
  }
  return cut({ ok: true, name, path: resolved.path, body: resolved.body });
}

function saveSkill(draft: Draft, args: unknown): unknown {
  const record = args && typeof args === "object" ? args : {};
  const nameHint = "name" in record && typeof record.name === "string" ? record.name.trim() : "";
  const prior = nameHint ? draft.skills[nameHint] ?? shelfFromPackage(draft.skillPackages[nameHint]) : undefined;
  const saved = saveUserSkill({
    name: "name" in record ? record.name : undefined,
    description: "description" in record ? record.description : prior?.description,
    body: "body" in record ? record.body : prior?.body,
    material: "material" in record ? record.material : "utterance",
    files: "files" in record ? record.files : prior?.files
  });
  if (!saved.ok) return saved;
  const mergedFiles = {
    ...(draft.skillPackages[saved.skill.name]?.files ?? {}),
    ...(prior?.files ?? {}),
    ...(saved.skill.files ?? {})
  };
  const skill: UserSkill = {
    ...saved.skill,
    ...(Object.keys(mergedFiles).length > 0 ? { files: mergedFiles } : {})
  };
  draft.skills = { ...draft.skills, [skill.name]: skill };
  draft.skillPackages = {
    ...draft.skillPackages,
    [skill.name]: mergeSkillPackage(draft.skillPackages[skill.name], skill)
  };
  return { ok: true, accepted: true, name: skill.name, updated: Boolean(prior) };
}

function writeSkillResource(draft: Draft, args: unknown): unknown {
  const record = args && typeof args === "object" ? args : {};
  const name = toolName(args);
  if (!name) return { ok: false, reason: "invalid_value", detail: { constraint: "name が要る" } };
  const pathRaw = "path" in record && typeof record.path === "string" ? record.path.trim() : "";
  const body = "body" in record && typeof record.body === "string" ? record.body : undefined;
  if (!pathRaw || body === undefined) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "path と body が要る" } };
  }
  const files = normalizeSkillFiles({ [pathRaw]: body });
  if (!files) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "path または body が不正" } };
  }
  const pkg = draft.skillPackages[name];
  const prior = draft.skills[name] ?? shelfFromPackage(pkg);
  if (!prior && !pkg) {
    return { ok: false, reason: "record_not_found", detail: { name } };
  }
  const base: UserSkill = prior ?? {
    name,
    description: pkg!.frontmatter.description,
    body: pkg!.instructions,
    files: { ...pkg!.files }
  };
  const nextFiles = { ...(base.files ?? pkg?.files ?? {}), ...files };
  const skill: UserSkill = { ...base, name, files: nextFiles };
  draft.skills = { ...draft.skills, [name]: skill };
  draft.skillPackages = {
    ...draft.skillPackages,
    [name]: mergeSkillPackage(pkg ?? BUNDLED_SKILL_PACKAGES[name], skill)
  };
  return { ok: true, accepted: true, name, path: Object.keys(files)[0] };
}

function shelfFromPackage(pkg: SkillPackage | undefined): UserSkill | undefined {
  if (!pkg) return undefined;
  return {
    name: pkg.frontmatter.name,
    description: pkg.frontmatter.description,
    body: pkg.instructions,
    ...(Object.keys(pkg.files).length > 0 ? { files: { ...pkg.files } } : {})
  };
}

function kanbanAdd(input: TurnInput, draft: Draft, args: unknown): unknown {
  const record = args && typeof args === "object" ? args : {};
  const requested = "id" in record && typeof record.id === "string" ? record.id.trim() : "";
  const id = requested && !draft.board.cards.has(requested)
    ? requested
    : mintCardId(draft.board.cards, input.now);
  const applied = applyCardChange(draft.board, {
    create: true,
    id,
    title: "title" in record && typeof record.title === "string" ? record.title : undefined,
    state: "state" in record && typeof record.state === "string" ? record.state : undefined,
    body: "body" in record && typeof record.body === "string" ? record.body : undefined,
    due: "due" in record && (record.due === null || typeof record.due === "string") ? record.due : undefined,
    refs: "refs" in record && Array.isArray(record.refs) ? record.refs.filter((ref): ref is string => typeof ref === "string") : undefined
  }, input.now);
  if (!applied.ok) return applied;
  draft.board = applied.board;
  return { ok: true, accepted: true, id, state: applied.card?.state ?? "未着手", title: applied.card?.title };
}

function mintCardId(cards: ReadonlyMap<string, unknown>, now: number): string {
  let n = cards.size + 1;
  let id = `card-${n}-${now}`;
  while (cards.has(id)) {
    n += 1;
    id = `card-${n}-${now}`;
  }
  return id;
}

function kanbanUpdate(input: TurnInput, draft: Draft, args: unknown): unknown {
  const record = args && typeof args === "object" ? args : {};
  const id = "id" in record && typeof record.id === "string" ? record.id : "";
  const del = "delete" in record && record.delete === true;
  if (del && !input.allowDestructive) {
    const hasOther =
      ("state" in record && record.state !== undefined) ||
      ("title" in record && record.title !== undefined) ||
      ("body" in record && record.body !== undefined);
    if (hasOther) {
      return { ok: false, reason: "invalid_value", detail: { constraint: "削除と他の変更は同時にできない" } };
    }
    return holdPendingDelete(input, draft, { kind: "card", id });
  }
  const applied = applyCardChange(draft.board, {
    id,
    delete: del || undefined,
    state: "state" in record && typeof record.state === "string" ? record.state : undefined,
    title: "title" in record && typeof record.title === "string" ? record.title : undefined,
    body: "body" in record && typeof record.body === "string" ? record.body : undefined
  }, input.now);
  if (!applied.ok) return applied;
  draft.board = applied.board;
  return { ok: true, accepted: true, id, state: applied.card.state };
}

function code(draft: Draft, args: unknown): unknown {
  const source = args && typeof args === "object" && "source" in args && typeof args.source === "string" ? args.source : "";
  if (!source) return { ok: false, reason: "invalid_value", detail: { constraint: "source が要る" } };
  const result = runCode(source);
  if (!result.ok) return result;
  draft.sources.push(result.value);
  draft.codeMarks.push(result.value);
  return result;
}

function registered(calcs: TurnInput["calcs"], args: unknown): unknown {
  const name = toolName(args);
  const fn = name ? calcs?.get(name) : undefined;
  if (!fn) return { ok: false, reason: "unknown_tool", detail: { name } };
  const value = fn(args && typeof args === "object" && "input" in args ? args.input : undefined);
  if (value && typeof value === "object" && "ok" in value) return value;
  return { ok: true, value };
}

function registeredJob(jobs: TurnInput["jobs"], args: unknown): unknown {
  const name = toolName(args);
  const fn = name ? jobs?.get(name) : undefined;
  if (!fn) return { ok: false, reason: "unknown_tool", detail: { name } };
  return fn("input" in (args as object) ? (args as { input: unknown }).input : undefined);
}

function show(draft: Draft, args: unknown): unknown {
  const view = args && typeof args === "object" && "view" in args && typeof args.view === "string" ? args.view : "";
  if (!view || view === "property") {
    return { ok: false, reason: "invalid_value", detail: { constraint: "物件のタブはまだ無い" } };
  }
  if (view === "kanban") {
    const focus = args && typeof args === "object" && "focus" in args && typeof args.focus === "string" ? args.focus : null;
    const card = focus ? draft.board.cards.get(focus) : undefined;
    if (card && card.deletedAt === null) {
      for (const value of sourceValues(card, draft.ledger)) draft.sources.push(value);
    }
    return cut({ ok: true, view, context: boardContext(draft.board, focus) });
  }
  return { ok: true, view };
}

function proposePlan(input: TurnInput, draft: Draft, args: unknown): unknown {
  const text = args && typeof args === "object" && "text" in args && typeof args.text === "string" ? args.text : "";
  if (!text) return { ok: false, reason: "invalid_value", detail: { constraint: "text が要る" } };
  const raw = input.jev?.(text) ?? "down";
  if (isThenable(raw)) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "非同期 Jev はライブターンで使う" } };
  }
  return applyJevVerdict(draft, text, raw);
}

async function proposePlanAsync(input: TurnInput, draft: Draft, args: unknown): Promise<unknown> {
  const text = args && typeof args === "object" && "text" in args && typeof args.text === "string" ? args.text : "";
  if (!text) return { ok: false, reason: "invalid_value", detail: { constraint: "text が要る" } };
  const verdict = await Promise.resolve(input.jev?.(text) ?? "down");
  return applyJevVerdict(draft, text, verdict);
}

function applyJevVerdict(draft: Draft, text: string, verdict: boolean | "down"): unknown {
  if (verdict === false) return { ok: false, reason: "plan_pending", detail: { constraint: "保存の意図が確認できなかった" } };
  draft.planText = text;
  return { ok: true, pending: true, note: "ユーザーの承認待ち。承認されるまで書き込みは止まる。" };
}

function search(input: TurnInput, draft: Draft, args: unknown): unknown {
  const query = args && typeof args === "object" && "query" in args && typeof args.query === "string" ? args.query : "";
  if (!query) return { ok: false, reason: "invalid_value", detail: { constraint: "query が要る" } };
  // 上限・メール検査の前に adapter を呼ばない（課金・漏洩の両方）
  const gated = webSearch(draft.searches, query, () => []);
  if (!gated.ok) return gated;
  const raw = (input.search ?? (() => []))(query);
  if (isThenable(raw)) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "非同期検索はライブターンで使う" } };
  }
  const outcome = webSearch(draft.searches, query, () => raw);
  if (!outcome.ok) return outcome;
  draft.searches += 1;
  for (const hit of outcome.results) draft.urls.push(hit.url);
  rememberNumbers(outcome.results, draft.sources);
  return cut(outcome);
}

async function searchAsync(input: TurnInput, draft: Draft, args: unknown): Promise<unknown> {
  const query = args && typeof args === "object" && "query" in args && typeof args.query === "string" ? args.query : "";
  if (!query) return { ok: false, reason: "invalid_value", detail: { constraint: "query が要る" } };
  const outcome = await webSearchAsync(draft.searches, query, input.search ?? (() => []));
  if (!outcome.ok) return outcome;
  draft.searches += 1;
  const allow = input.browserHostAllow ?? browserHostAllowFromEnv(envBag());
  const results = await enrichSearchHitsWithOg(outcome.results, { allowHosts: allow });
  for (const hit of results) draft.urls.push(hit.url);
  rememberNumbers(results, draft.sources);
  const persist = buildResearchPersistGuidance({
    searchesUsed: draft.searches,
    searchMax: WEB_SEARCH_PER_TURN,
    fetchesUsed: draft.browserFetches,
    fetchMax: BROWSER_FETCH_PER_TURN,
    triedHosts: draft.fetchHosts,
    kind: results.length > 0 ? "search_hits" : "search_empty"
  });
  const coverage = evaluateCoverage({
    queryClass: draft.researchClass,
    facts: draft.factLedger,
    successHosts: Object.keys(draft.fetchSuccessByHost)
  });
  const gap = buildGapQueryGuidance({
    coverage,
    searchLeft: Math.max(0, WEB_SEARCH_PER_TURN - draft.searches)
  });
  const early =
    !coverage.met && draft.browserFetches < BROWSER_FETCH_PER_TURN && results.length > 0
      ? "カバレッジ未達かつ精読残あり。候補を精読せず『確認できない』で終わらない。"
      : "";
  return cut({
    ...outcome,
    results,
    query,
    guidance: [results.length > 0
      ? `results は画面の picks に載る。写真付き候補は Markdown 表に画像を埋め込まない。本文は短い補足まで。各 url は出典。${persist}`
      : persist, gap, early].filter(Boolean).join(" ")
  });
}

async function resolveRouteAsync(args: unknown): Promise<unknown> {
  const outcome = await resolveRoute(args);
  if (!outcome.ok) {
    if (outcome.reason === "ambiguous") {
      return {
        ...outcome,
        guidance:
          "端点が曖昧。候補は画面の地図に載る。ユーザーが採用した lat/lng で resolve_route を再実行するか、施設なら web_search で番地を取って address に渡し直す。近い候補だけに決め打ちせず、遠い候補も残す。検索リンクだけでルート済みとしない。"
      };
    }
    return outcome;
  }
  // coordinates は UI 用。cut するとプレビュー壊れで地図が出ない。モデル向けは要約を添える。
  return {
    ok: true,
    profile: outcome.profile,
    distanceM: outcome.distanceM,
    durationS: outcome.durationS,
    origin: outcome.origin,
    destination: outcome.destination,
    coordinates: outcome.coordinates,
    guidance:
      "経路は画面の地図（map_snip.route）に載る。距離・時間は distanceM / durationS のみ。外部地図リンクだけで代替しない。coordinates は地図用なので本文に列挙しない。"
  };
}

function rememberFetchHost(draft: Draft, url: string): void {
  const host = hostnameOf(url);
  if (!host) return;
  if (!draft.fetchHosts.includes(host)) draft.fetchHosts.push(host);
}

function recordFetchFailure(draft: Draft, url: string, reason: string): void {
  const host = hostnameOf(url) ?? "unknown";
  rememberFetchHost(draft, url);
  if (!draft.failedHosts.includes(host)) draft.failedHosts.push(host);
  draft.failureLedger.push({ host, url, reason });
}

function recordFetchSuccess(draft: Draft, url: string): void {
  const host = hostnameOf(url);
  rememberFetchHost(draft, url);
  if (!host) return;
  draft.fetchSuccessByHost[host] = (draft.fetchSuccessByHost[host] ?? 0) + 1;
}

function coverageGuidance(draft: Draft): string {
  const coverage = evaluateCoverage({
    queryClass: draft.researchClass,
    facts: draft.factLedger,
    successHosts: Object.keys(draft.fetchSuccessByHost)
  });
  if (coverage.met) return "カバレッジ充足。短い合成と出典でよい。";
  const gap = buildGapQueryGuidance({
    coverage,
    searchLeft: Math.max(0, WEB_SEARCH_PER_TURN - draft.searches)
  });
  const ledger = formatFailureLedger(draft.failureLedger);
  const early =
    draft.browserFetches < BROWSER_FETCH_PER_TURN
      ? "精読残あり。『確認できない』だけで終わらない。"
      : "";
  return [gap, early, ledger].filter(Boolean).join(" ");
}

async function browserFetchAsync(input: TurnInput, draft: Draft, args: unknown): Promise<unknown> {
  const url = args && typeof args === "object" && "url" in args && typeof args.url === "string" ? args.url : "";
  if (!url.trim()) return { ok: false, reason: "invalid_value", detail: { constraint: "url が要る" } };
  const hostGate = assertFetchHost({
    url,
    failedHosts: draft.failedHosts,
    successByHost: draft.fetchSuccessByHost
  });
  if (!hostGate.ok) {
    return cut({
      ok: false,
      reason: "host_policy",
      detail: { constraint: hostGate.detail },
      guidance: `${hostGate.detail} ${coverageGuidance(draft)}`
    });
  }
  const allow = input.browserHostAllow ?? browserHostAllowFromEnv(envBag());
  const rendered = input.browserRendered ?? productRenderedRead(envBag());
  const outcome = await browserFetch(draft.browserFetches, url, input.browser, allow, {
    rendered,
    rendersSoFar: draft.renderedFetches,
    renderMax: BROWSER_RENDER_PER_TURN,
    onRenderedAttempt: () => {
      draft.renderedFetches += 1;
    }
  });
  if (!outcome.ok) {
    // 壁・使えぬ本文も試行は消費（次 URL を予算内で回す）
    if (outcome.reason === "content_wall" || outcome.reason === "unusable_content") {
      draft.browserFetches += 1;
      recordFetchFailure(draft, url, outcome.reason);
    }
    const failGuidance =
      outcome.reason === "provider_auth"
        ? "Browser Run 側の認証失敗。対象ページが要ログインだとは言わない。"
        : [
            buildResearchPersistGuidance({
              searchesUsed: draft.searches,
              searchMax: WEB_SEARCH_PER_TURN,
              fetchesUsed: draft.browserFetches,
              fetchMax: BROWSER_FETCH_PER_TURN,
              triedHosts: draft.fetchHosts,
              kind: "fetch_fail"
            }),
            coverageGuidance(draft)
          ].join(" ");
    return cut({
      ...outcome,
      guidance: failGuidance
    });
  }
  draft.browserFetches += 1;
  const finalUrl = outcome.result.finalUrl ?? outcome.result.url;
  draft.urls.push(finalUrl);
  recordFetchSuccess(draft, finalUrl);
  const markdown = typeof outcome.result.markdown === "string" ? outcome.result.markdown : "";
  const facts = extractWebFacts(markdown);
  if (facts.length) {
    rememberNumbers(facts, draft.sources);
    for (const fact of facts) {
      draft.factLedger.push({ ...fact, sourceUrl: finalUrl });
    }
  }
  // 構造（ok / facts / url）を cut の preview 化で壊さない。markdown を先に削る。
  const body = {
    ok: true as const,
    result: {
      url: outcome.result.url,
      finalUrl: outcome.result.finalUrl,
      ...(typeof outcome.result.title === "string" ? { title: outcome.result.title } : {}),
      markdown: markdown.slice(0, 4_500),
      ...(outcome.result.truncated ? { truncated: true } : {})
    },
    ...(facts.length ? { facts } : {}),
    guidance: [
      buildResearchPersistGuidance({
        searchesUsed: draft.searches,
        searchMax: WEB_SEARCH_PER_TURN,
        fetchesUsed: draft.browserFetches,
        fetchMax: BROWSER_FETCH_PER_TURN,
        triedHosts: draft.fetchHosts,
        kind: "fetch_ok"
      }),
      coverageGuidance(draft)
    ].join(" ")
  };
  const json = JSON.stringify(body);
  if (json.length <= TOOL_RESULT_CHARS) return body;
  return {
    ...body,
    result: {
      ...body.result,
      markdown: markdown.slice(0, 1_500)
    },
    truncated: true
  };
}

async function browserActAsync(input: TurnInput, draft: Draft, call: ToolCall): Promise<unknown> {
  const allow = input.browserHostAllow ?? browserHostAllowFromEnv(envBag());
  const session = input.browserSession;
  const guidance =
    "利用許諾や Cookie は ## dialogs の表記をそのまま browser_click（採否はモデル。基盤は文言リストを持たない）。CAPTCHA・ログイン回避はしない。読めない・行き詰まり・ユーザー引き継ぎは browser_request_handoff（close しない）。パスワードをチャットに書かせない。読むだけなら browser_fetch。";

  if (input.browserHeldElsewhere) {
    return {
      ok: false,
      reason: "browser_busy",
      detail: { constraint: "別のスレッドでブラウザ操作を引き継ぎ中。そちらで完了かやめるを押してから" }
    };
  }

  if (call.name === "browser_navigate") {
    const url = call.args && typeof call.args === "object" && "url" in call.args && typeof call.args.url === "string"
      ? call.args.url
      : "";
    const outcome = await browserNavigate(draft.browserActs, session, url, allow);
    if (!outcome.ok) {
      const unreachable =
        outcome.detail?.unreachable === true ||
        isBrowserUnreachableConstraint(outcome.detail?.constraint);
      if (unreachable) draft.browserUnreachable = true;
      return cut({
        ...outcome,
        guidance: unreachable
          ? "この実行環境の出口からは開けない。同一 URL を連打しない。browser_request_handoff はするな（共有画面が無く偽の引き継ぎになる）。URL と手順を本文で伝え、必要な数値はチャットで聞いて。"
          : guidance
      });
    }
    draft.browserActs += 1;
    draft.browserOpened = true;
    if ("url" in outcome.result) draft.urls.push(outcome.result.url);
    return cut({ ...outcome, guidance });
  }
  if (call.name === "browser_snapshot") {
    const outcome = await browserSnapshot(draft.browserActs, session, draft.browserOpened, allow);
    if (!outcome.ok) {
      if (outcome.reason === "private_host" || outcome.reason === "host_denied") draft.browserOpened = false;
      return cut(outcome);
    }
    draft.browserActs += 1;
    return cut({ ...outcome, guidance });
  }
  if (call.name === "browser_click") {
    const args = call.args && typeof call.args === "object" ? (call.args as Record<string, unknown>) : {};
    const outcome = await browserClick(
      draft.browserActs,
      session,
      draft.browserOpened,
      {
        name: typeof args.name === "string" ? args.name : undefined,
        role: typeof args.role === "string" ? args.role : undefined,
        selector: typeof args.selector === "string" ? args.selector : undefined
      },
      allow
    );
    if (!outcome.ok) {
      if (outcome.reason === "private_host" || outcome.reason === "host_denied") draft.browserOpened = false;
      return cut(outcome);
    }
    draft.browserActs += 1;
    return cut({ ...outcome, guidance });
  }
  if (call.name === "browser_type") {
    const selector =
      call.args && typeof call.args === "object" && "selector" in call.args && typeof call.args.selector === "string"
        ? call.args.selector
        : "";
    const text =
      call.args && typeof call.args === "object" && "text" in call.args && typeof call.args.text === "string"
        ? call.args.text
        : "";
    const submit =
      call.args && typeof call.args === "object" && "submit" in call.args && call.args.submit === true
        ? true
        : false;
    const outcome = await browserType(
      draft.browserActs,
      session,
      draft.browserOpened,
      selector,
      text,
      submit,
      allow
    );
    if (!outcome.ok) {
      if (outcome.reason === "private_host" || outcome.reason === "host_denied") draft.browserOpened = false;
      return cut(outcome);
    }
    draft.browserActs += 1;
    return cut({ ...outcome, guidance });
  }
  if (call.name === "browser_scroll") {
    const args = call.args && typeof call.args === "object" ? (call.args as Record<string, unknown>) : {};
    const direction = args.direction === "up" || args.direction === "down" ? args.direction : "down";
    const outcome = await browserScroll(
      draft.browserActs,
      session,
      draft.browserOpened,
      {
        direction,
        amount: typeof args.amount === "number" ? args.amount : undefined,
        selector: typeof args.selector === "string" ? args.selector : undefined
      },
      allow
    );
    if (!outcome.ok) {
      if (outcome.reason === "private_host" || outcome.reason === "host_denied") draft.browserOpened = false;
      return cut(outcome);
    }
    draft.browserActs += 1;
    return cut({ ...outcome, guidance });
  }
  if (call.name === "browser_select") {
    const args = call.args && typeof call.args === "object" ? (call.args as Record<string, unknown>) : {};
    const outcome = await browserSelect(
      draft.browserActs,
      session,
      draft.browserOpened,
      {
        selector: typeof args.selector === "string" ? args.selector : "",
        value: typeof args.value === "string" ? args.value : undefined,
        label: typeof args.label === "string" ? args.label : undefined
      },
      allow
    );
    if (!outcome.ok) {
      if (outcome.reason === "private_host" || outcome.reason === "host_denied") draft.browserOpened = false;
      return cut(outcome);
    }
    draft.browserActs += 1;
    return cut({ ...outcome, guidance });
  }
  if (call.name === "browser_close") {
    const outcome = await browserClose(session);
    draft.browserOpened = false;
    draft.pendingBrowserHandoff = null;
    return cut({
      ...outcome,
      guidance:
        "セッションを閉じた。これからユーザーに操作を渡す必要があったなら誤り。開き直して browser_request_handoff すること。"
    });
  }
  if (call.name === "browser_request_handoff") {
    const args = call.args && typeof call.args === "object" ? (call.args as Record<string, unknown>) : {};
    const outcome = await browserRequestHandoff(
      session,
      draft.browserOpened,
      args.reason,
      args.task,
      input.now
    );
    if (!outcome.ok) {
      return cut({
        ...outcome,
        guidance:
          outcome.reason === "not_open"
            ? draft.browserUnreachable
              ? "到達不能で共有画面が無い。handoff を繰り返すな。URL と手順を本文で書き、数値はチャットで聞く。"
              : "ページが開いていない。browser_navigate で対象を開き直してから再度 browser_request_handoff。"
            : outcome.reason === "no_live_view"
              ? "操作画面を渡せない（Live View／ローカル面が無い）。handoff カードは出さない。本文で案内しチャットで聞く。住所の聞き直しだけで終わらない。"
              : outcome.reason === "invalid_value"
                ? "task にユーザーが画面でやる具体と完了条件を書いて再度 browser_request_handoff。手続き説明だけは不可。"
                : "handoff に失敗した。渡したとは言わない。"
      });
    }
    draft.pendingBrowserHandoff = outcome.result;
    draft.planText = null;
    draft.pendingDelete = null;
    draft.pendingMcp = null;
    return cut({
      ...outcome,
      guidance:
        "ユーザーに操作を渡した。本文は task の繰り返しを避け一行でよい。追加の browser 操作はしない。「自分で操作」「完了」は画面のボタン。ツールなしで渡したと言わない。"
    });
  }
  return { ok: false, reason: "invalid_value", detail: { constraint: "未知のブラウザ操作" } };
}

async function delegateTasksAsync(
  input: TurnInput,
  draft: Draft,
  args: unknown
): Promise<unknown> {
  if (!("complete" in input) || typeof (input as LiveTurnInput).complete !== "function") {
    return {
      ok: false,
      reason: "async_only",
      detail: { constraint: "delegate_tasks はライブターンで使う" }
    };
  }
  if ((input.delegateDepth ?? 0) > 0) {
    return {
      ok: false,
      reason: "nested_delegate",
      detail: { constraint: "委任の入れ子は禁止" }
    };
  }
  const specs = parseDelegateTasks(args);
  if (!specs.length) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "tasks（id と goal）が要る" } };
  }
  const live = input as LiveTurnInput;
  const results = await runDelegateTasks(specs, async (spec) => {
    const child = await runLiveTurn({
      ...live,
      userText: spec.goal,
      maxToolCalls: Math.min(live.maxToolCalls ?? 8, 4),
      delegateDepth: 1,
      attachments: undefined
    });
    rememberNumbers(child.toolLog, draft.sources);
    return {
      id: spec.id,
      ok: child.operation.ok,
      summary: child.text.trim().slice(0, 400),
      uiParts: child.uiParts,
      numbers: []
    };
  });
  for (const row of results) {
    draft.uiParts.push(...row.uiParts);
  }
  draft.delegates += results.length;
  return cut({
    ok: true,
    tasks: results.map((row) => ({ id: row.id, ok: row.ok, summary: row.summary })),
    guidance:
      "各 task の summary を短い本文に統合する。面は既に出ているので同じ内容を長文で繰り返さない。"
  });
}

function isThenable(value: unknown): value is Promise<unknown> {
  return Boolean(value && typeof value === "object" && "then" in value);
}

function toolName(args: unknown): string | null {
  if (!args || typeof args !== "object" || !("name" in args) || typeof args.name !== "string") return null;
  return args.name;
}

function rememberNumbers(value: unknown, sources: number[]): void {
  if (typeof value === "number" && Number.isFinite(value)) sources.push(value);
  else if (Array.isArray(value)) value.forEach((item) => rememberNumbers(item, sources));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => rememberNumbers(item, sources));
}

function cut(body: unknown): unknown {
  const json = JSON.stringify(body);
  if (json.length <= TOOL_RESULT_CHARS) return body;
  return { preview: json.slice(0, TOOL_RESULT_CHARS), more: json.length - TOOL_RESULT_CHARS };
}

export type { SearchHit };
