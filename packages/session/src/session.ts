// 製品の手元セッション。評価卓の画面は使わない。desk と runTurn は同じ関数を通す。
import {
  createDesk,
  deskAddCard,
  deskAdvance,
  deskDraftSkill,
  deskEnable,
  deskInterrupt,
  deskMoveCard,
  deskProposePlan,
  deskResolvePlan,
  deskSaveWorkflow,
  deskSpeak,
  deskStartJob,
  deskWriteMemo,
  deskWriteNote,
  decodeAttachment,
  describeSpeakAttachments,
  deskDeleteCard,
  deskDeleteItem,
  deskDeleteNote,
  deskJobs,
  deskClearBrowserHandoff,
  deskCompleteMcpOAuth,
  deskFailMcpOAuth,
  deskRemoveMcp,
  deskSaveMcp,
  deskSetPendingMcpOAuth,
  beginMcpOAuthFlow,
  finishMcpOAuthFlow,
  catalogById,
  httpMcpTransport,
  isPendingDeleteKind,
  probeMcp,
  type PendingDelete,
  aiChat,
  aiStopText,
  CHAT_MODEL_CHOICES,
  chatModelFor,
  deploymentChatModel,
  isSelectableChatModel,
  loadChatConfig,
  DEFAULT_THREAD_TITLE,
  fallbackThreadTitle,
  suggestThreadTitle,
  productBrowserFetch,
  productBrowserSession,
  productRenderedRead,
  productJev,
  productSearch,
  browserHostAllowFromEnv,
  isHandoffExpired,
  isDailyTokenCapReached,
  domainPack,
  type DomainRoute,
  type DomainRouteRequest,
  formatMcpProbeReason,
  resolveDailyTokenCap,
  runLiveTurn,
  snapshot,
  TOKEN_CAP_MESSAGE,
  type ChatComplete,
  type AgentHost,
  type CliRunner,
  type Desk,
  type McpServer,
  type McpTransport,
  keepLastBrowserPreview,
  type PendingBrowserHandoff,
  type SpeakAttachment,
  type ToolProgress,
  type UiPart
} from "agent";
import {
  browserHandoffThreadId,
  currentBrowserHandoff,
  mountThreadHitl,
  settleDeskHitl,
  stowThreadHitl,
  withThreadHitl,
  withThreadHitlAsync,
  type ThreadHitl
} from "./threadHitl";

export { browserHandoffThreadId, settleDeskHitl, type ThreadHitl } from "./threadHitl";

export const UTTERANCE_CHARS = 20_000;
export const EMPTY_MODEL_TEXT = "AI バインディングがありません。Worker（cf dev か本番）から開いてください。スキルは「読んで:名称」で読めます。";

/**
 * 会話に載せる最終本文。
 * handoff 待ちは Banner が task を出すので空を許容する（「応答が空でした」にしない）。
 */
export function speakAnswerText(turn: {
  text: string;
  pendingBrowserHandoff?: unknown;
}): string {
  const text = turn.text.trim();
  if (text) return text;
  if (turn.pendingBrowserHandoff) return "";
  return "（応答が空でした）";
}
export const MODEL_ERROR_TEXT = "対話モデルへの接続に失敗しました。AI Gateway のログを確認してください。";
/** 完了報告後。Done クリックを成功根拠にしない（BrowserHub）。 */
export const BROWSER_HANDOFF_RESUME_DONE =
  "ユーザーがブラウザ操作を完了したと報告した。成功を断定せず、まず browser_snapshot で現在の画面を確認してから、元の依頼の続きを進めて。";

/** 到達不能などで共有セッションが無い handoff。手元画面は戻らない。 */
export const BROWSER_HANDOFF_RESUME_LOCAL_ONLY_DONE =
  "ユーザーが手元ブラウザで調べ終えたと報告した。リモートに共有画面は無い。browser_snapshot や同一 URL の navigate 再試行はしない。チャットで必要な数値・結果を聞き、報告に基づき続きを進める。";

export function browserHandoffResumeFailed(note?: string, localOnly = false): string {
  const reason = note?.trim() ? `理由: ${note.trim()}。` : "";
  if (localOnly) {
    return `ユーザーが手元での調査をやめた。${reason}browser_snapshot はしない。別手段か、チャットでの聞き取りに切り替える。成功を断定しない。`;
  }
  return `ユーザーがブラウザ操作をやめた。${reason}成功を断定せず、まず browser_snapshot で現状を確認し、別手段か説明をする。`;
}

export function browserHandoffResumeExpired(localOnly = false): string {
  if (localOnly) {
    return "手元調査の引き継ぎが期限切れになった。browser_snapshot はしない。必要ならチャットで聞き直すか別手段を取る。成功を断定しない。";
  }
  return "ブラウザ操作の引き継ぎが期限切れになった。まず browser_snapshot で現状を確認し、必要なら再度 handoff するか別手段を取る。成功を断定しない。";
}

/** @deprecated BROWSER_HANDOFF_RESUME_DONE を使う */
export const BROWSER_HANDOFF_RESUME = BROWSER_HANDOFF_RESUME_DONE;

export interface ThreadLine {
  role: "user" | "assistant";
  text: string;
  attachments?: { name: string; media: string }[];
  /** プレビュー無しの活動ラベル。 */
  activities?: ToolProgress[];
  /** Generative UI Phase 1。未知 kind はクライアントでスキップ。 */
  ui?: UiPart[];
  /** この応答を出した対話モデル。 */
  model?: string;
}

export interface Thread {
  id: string;
  title: string;
  titleLocked: boolean;
  updatedAt: number;
  lines: ThreadLine[];
  hitl?: ThreadHitl | null;
  /** 共有ブラウザを人へ渡している間だけ。全スレッドで高々1つ。 */
  browserHandoff?: PendingBrowserHandoff | null;
  /** 画面で選んだ対話モデル。無ければ配備の既定。 */
  model?: string;
}

export type UndoEntry = { kind: "note" | "card"; id: string };

export interface Session {
  desk: Desk;
  threads: Thread[];
  activeThreadId: string | null;
  seq: number;
  undoStack: UndoEntry[];
}

export interface DraftSpeak {
  task: string;
  tokens: string[];
  tools: ToolProgress[];
  next: Session;
  rejected: "too_long" | null;
  /** 当ターンでプロバイダ usage から集計したトークン。D1 加算用。 */
  tokensUsed: number;
}

export type SpeakQuota = {
  tokensToday?: number;
  tokenCap?: number | null;
};

export type ViewUsage = {
  tokensToday?: number;
  tokenCap?: number | null;
};

export function createSession(): Session {
  return { desk: createDesk(), threads: [], activeThreadId: null, seq: 0, undoStack: [] };
}

export type DomainRouteOutcome =
  | { kind: "session"; session: Session; extra?: Record<string, unknown> }
  | { kind: "file"; bytes: Uint8Array; contentType: string; filename: string }
  | { kind: "error"; status: number; reason: string };

/** 差し込まれたドメインの経路を卓へ当て、応答の行をスレッドへ足す。 */
export async function runDomainRoute(
  route: DomainRoute,
  request: DomainRouteRequest,
  session: Session,
  now: number
): Promise<DomainRouteOutcome> {
  const result = await route.handle(request, session.desk, now);
  if (result.kind !== "desk") return result;
  let next: Session = { ...session, desk: result.desk };
  for (const line of result.lines ?? []) {
    next = appendAssistantWithUi(next, line.text, now, line.activities ?? [], line.ui ?? []);
  }
  return { kind: "session", session: next, ...(result.extra ? { extra: result.extra } : {}) };
}

export function renameThread(session: Session, id: string, title: string): Session {
  const next = title.trim();
  if (!next) return session;
  return {
    ...session,
    threads: session.threads.map((thread) => thread.id === id ? { ...thread, title: next, titleLocked: true } : thread)
  };
}

/** 一覧の外のモデル名は保存しない（null を返す）。 */
export function setThreadModel(session: Session, id: string, model: string): Session | null {
  const next = model.trim();
  if (!isSelectableChatModel(process.env, next)) return null;
  if (!session.threads.some((thread) => thread.id === id)) return null;
  return {
    ...session,
    threads: session.threads.map((thread) => thread.id === id ? { ...thread, model: next } : thread)
  };
}

function threadModel(session: Session, id: string | null = session.activeThreadId): string | undefined {
  return session.threads.find((thread) => thread.id === id)?.model;
}

export function selectThread(session: Session, id: string): Session {
  if (!session.threads.some((thread) => thread.id === id)) return session;
  return { ...session, activeThreadId: id };
}

export function createThread(session: Session, now: number): Session {
  const emptyActive = session.threads.find(
    (thread) =>
      thread.id === session.activeThreadId &&
      thread.lines.length === 0 &&
      !thread.titleLocked
  );
  if (emptyActive) return session;
  const id = `t${session.seq + 1}`;
  const inherited = threadModel(session);
  const thread: Thread = {
    id,
    title: DEFAULT_THREAD_TITLE,
    titleLocked: false,
    updatedAt: now,
    lines: [],
    ...(inherited ? { model: inherited } : {})
  };
  return {
    ...session,
    activeThreadId: id,
    threads: [...session.threads, thread],
    seq: session.seq + 1
  };
}

/**
 * speak / handoff 完了時、発信スレッドの結果を最新セッションへ取り込む。
 * ターン中に新規会話へ移っていても activeThreadId は latest を保ち、他スレッドを潰さない。
 */
export function mergeSpeakCommit(latest: Session, spoken: Session, originThreadId: string): Session {
  const spokenOrigin = spoken.threads.find((thread) => thread.id === originThreadId);
  if (!spokenOrigin) {
    return {
      ...spoken,
      activeThreadId: latest.activeThreadId ?? spoken.activeThreadId,
      threads: mergeThreadRoster(latest.threads, spoken.threads),
      seq: Math.max(latest.seq, spoken.seq)
    };
  }
  const latestOrigin = latest.threads.find((thread) => thread.id === originThreadId);
  const mergedOrigin: Thread = {
    ...spokenOrigin,
    title:
      latestOrigin?.titleLocked
        ? latestOrigin.title
        : spokenOrigin.title !== DEFAULT_THREAD_TITLE
          ? spokenOrigin.title
          : (latestOrigin?.title ?? spokenOrigin.title),
    titleLocked: latestOrigin?.titleLocked ?? spokenOrigin.titleLocked,
    ...((latestOrigin?.model ?? spokenOrigin.model) ? { model: latestOrigin?.model ?? spokenOrigin.model } : {})
  };
  const threads = mergeThreadRoster(
    latest.threads.map((thread) => (thread.id === originThreadId ? mergedOrigin : thread)),
    latest.threads.some((thread) => thread.id === originThreadId) ? [] : [mergedOrigin]
  );
  return {
    ...latest,
    desk: spoken.desk,
    undoStack: spoken.undoStack,
    threads,
    activeThreadId: latest.activeThreadId,
    seq: Math.max(latest.seq, spoken.seq)
  };
}

function mergeThreadRoster(base: Thread[], extra: Thread[]): Thread[] {
  const byId = new Map(base.map((thread) => [thread.id, thread]));
  for (const thread of extra) {
    if (!byId.has(thread.id)) byId.set(thread.id, thread);
  }
  return [...byId.values()];
}

export function addCard(session: Session, title: string, now: number, state?: string): Session {
  const before = session.desk.board.cards.size;
  const desk = deskAddCard(session.desk, title, now, state);
  if (desk.board.cards.size <= before) return { ...session, desk };
  return { ...session, desk };
}

export function moveCard(session: Session, id: string, state: string, now: number): Session {
  return { ...session, desk: deskMoveCard(session.desk, id, state, now) };
}

export function draftSkill(session: Session, input: { name: string; description: string; body: string; material: "utterance" | "memo" }, now: number): Session {
  const desk = deskDraftSkill(session.desk, input, now);
  const text = desk.last?.text ?? desk.notice ?? "";
  return text ? appendAssistant({ ...session, desk: withoutNotice(desk) }, text, now) : { ...session, desk };
}

export function saveFlow(session: Session, raw: unknown, now = Date.now()): Session {
  return { ...session, desk: deskSaveWorkflow(session.desk, raw, now) };
}

export function enableFlow(session: Session, id: string, enabled: boolean): Session {
  return { ...session, desk: deskEnable(session.desk, id, enabled) };
}

export function advanceClock(session: Session, now: number): Session {
  const desk = deskAdvance(session.desk, now);
  const post = desk.posts.at(-1);
  const next = { ...session, desk };
  if (post && post !== session.desk.posts.at(-1)) return appendAssistant(next, post, now);
  return next;
}

export async function proposePlan(session: Session, text: string, now: number): Promise<Session> {
  const plan = text.trim();
  const verdict = await Promise.resolve(productJev()(plan));
  return withThreadHitl(session, null, now, (mounted) => {
    if (verdict === false) {
      const notice = "保存の意図が確認できなかったため、実行計画は出しません。";
      return appendAssistant({ ...mounted, desk: withoutNotice(mounted.desk) }, notice, now);
    }
    const desk = deskProposePlan(mounted.desk, plan, now, () => verdict);
    const answer = desk.last?.text ?? desk.notice ?? "実行計画を出しました。";
    return appendAssistant({ ...mounted, desk: withoutNotice(desk) }, answer, now);
  });
}

/** threadId 省略時は表示中スレッド。他スレッドの承認待ちには触れない。 */
export async function resolvePlan(
  session: Session,
  decision: "approve" | "reject",
  now: number,
  opts: { agentHost?: import("agent").AgentHost; threadId?: string } = {}
): Promise<Session> {
  const settled = settleDeskHitl(session, now);
  const viewing = settled.activeThreadId;
  const target =
    opts.threadId && settled.threads.some((thread) => thread.id === opts.threadId)
      ? opts.threadId
      : viewing;
  const resolved = await withThreadHitlAsync(
    { ...settled, activeThreadId: target },
    target,
    now,
    async (mounted) => {
      const desk = await deskResolvePlan(mounted.desk, decision, now, opts);
      const notice = desk.notice ?? (decision === "approve" ? "実行計画を承認した。" : "実行計画を却下した。");
      return appendAssistant({ ...mounted, desk: withoutNotice(desk) }, notice, now);
    }
  );
  return { ...resolved, activeThreadId: viewing ?? resolved.activeThreadId };
}

export function deleteItem(session: Session, kind: string, id: string, now: number): Session {
  if (!isPendingDeleteKind(kind) || !id.trim()) {
    return { ...session, desk: { ...session.desk, notice: "削除対象が不正" } };
  }
  const pending: PendingDelete = { kind, id: id.trim() };
  return withThreadHitl(session, null, now, (mounted) => ({
    ...mounted,
    desk: deskDeleteItem(mounted.desk, pending, now)
  }));
}

export function writeNote(session: Session, input: { id: string; title: string; body: string; value?: number | null }, now: number): Session {
  const id = input.id.trim() || `note-${session.desk.ledger.notes.size + 1}`;
  return withThreadHitl(session, null, now, (mounted) => ({
    ...mounted,
    desk: deskWriteNote(mounted.desk, { ...input, id }, now)
  }));
}

export function undoLast(session: Session, now: number): Session {
  const tip = session.undoStack.at(-1);
  if (!tip) {
    return { ...session, desk: { ...session.desk, notice: "取り消せる操作はない" } };
  }
  const desk = tip.kind === "note"
    ? deskDeleteNote(session.desk, tip.id, now)
    : deskDeleteCard(session.desk, tip.id, now);
  const notice = desk.notice ?? (tip.kind === "note" ? "ノートを取り消した。" : "カードを取り消した。");
  return {
    ...session,
    desk: { ...desk, notice },
    undoStack: session.undoStack.slice(0, -1)
  };
}

export function writeMemo(session: Session, input: { id: string; body: string }, now: number): Session {
  return withThreadHitl(session, null, now, (mounted) => ({
    ...mounted,
    desk: deskWriteMemo(mounted.desk, input, now)
  }));
}

export function startJob(session: Session, name: string, now: number): Session {
  const desk = deskStartJob(session.desk, name, now);
  const text = desk.last?.text ?? desk.notice ?? "";
  return text ? appendAssistant({ ...session, desk: withoutNotice(desk) }, text, now) : { ...session, desk };
}

export function interruptTurn(session: Session, now: number): Session {
  return withThreadHitl(session, null, now, (mounted) => {
    const desk = deskInterrupt(mounted.desk, now);
    const notice = desk.notice ?? "割り込みにより、保留中の変更を破棄した";
    return appendAssistant({ ...mounted, desk: withoutNotice(desk) }, notice, now);
  });
}

export type SpeakAdapters = {
  cliRunner?: CliRunner;
  agentHost?: AgentHost;
  mcp?: McpTransport;
  /** Workers 本番の browser-act Container など。未指定時は process.env から生成。 */
  browserSession?: import("agent").BrowserSession;
  /** ツール開始／完了をライブで伝える（SSE 用）。 */
  onTool?: (event: ToolProgress) => void;
};

/** 表示中スレッドの承認枠だけでターンを回す。他スレッドの承認待ち・引き継ぎに塞がれない。 */
export async function draftSpeak(
  session: Session,
  text: string,
  now: number,
  complete?: ChatComplete | null,
  attachments: readonly SpeakAttachment[] = [],
  quota: SpeakQuota = {},
  adapters: SpeakAdapters = {}
): Promise<DraftSpeak> {
  const settled = settleDeskHitl(session, now);
  const threadId = settled.activeThreadId;
  const owner = browserHandoffThreadId(settled);
  const drafted = await draftSpeakMounted(
    mountThreadHitl(settled, threadId),
    text,
    now,
    complete,
    attachments,
    quota,
    adapters,
    { browserHeldElsewhere: owner !== null && owner !== threadId }
  );
  return { ...drafted, next: stowThreadHitl(drafted.next, threadId ?? drafted.next.activeThreadId, now) };
}

async function draftSpeakMounted(
  session: Session,
  text: string,
  now: number,
  complete: ChatComplete | null | undefined,
  attachments: readonly SpeakAttachment[],
  quota: SpeakQuota,
  adapters: SpeakAdapters,
  scope: { browserHeldElsewhere: boolean }
): Promise<DraftSpeak> {
  const utterance = text.trim();
  if (utterance.length > UTTERANCE_CHARS) {
    return { task: "", tokens: [], tools: [], next: session, rejected: "too_long", tokensUsed: 0 };
  }
  if (attachments.length === 0 && !utterance) {
    return { task: "", tokens: [], tools: [], next: session, rejected: "too_long", tokensUsed: 0 };
  }

  // 前ターンの一過性 notice を残さない
  let withFiles = session.desk.notice ? { ...session, desk: withoutNotice(session.desk) } : session;
  const pack = domainPack();
  if (pack.attach) {
    for (const attachment of attachments) {
      const desk = pack.attach(withFiles.desk, { bytes: decodeAttachment(attachment), media: attachment.media, name: attachment.name }, now);
      // 台帳メタは残すが、OCR未接続の UNREAD バナーはチャット添付では出さない（画像は multimodal で渡す）
      withFiles = { ...withFiles, desk: withoutNotice(desk) };
    }
  }
  const lineMeta = attachments.map((item) => ({ name: item.name, media: item.media }));

  // 「読んで:」「計画して:」は殻の決定的経路。ドメインの横取りより先に扱う。
  const shellCommand = /^(読んで|計画して)[:：]/.test(utterance);
  const intercepted = !shellCommand && utterance ? pack.intercept?.({ desk: withFiles.desk, utterance, now }) ?? null : null;
  if (intercepted) {
    const activities = intercepted.activities ?? [];
    return finishSpeak(
      appendExchange(
        { ...withFiles, desk: withoutNotice(intercepted.desk) },
        utterance,
        intercepted.answer,
        now,
        lineMeta,
        activities,
        intercepted.ui ?? []
      ),
      utterance,
      intercepted.answer,
      { task: intercepted.task, tools: activities, tokensUsed: 0 }
    );
  }

  const tokenCap = quota.tokenCap !== undefined ? quota.tokenCap : resolveDailyTokenCap(process.env);
  const tokensToday = quota.tokensToday ?? 0;
  if (isDailyTokenCapReached(tokensToday, tokenCap)) {
    return finishSpeak(
      appendExchange(withFiles, utterance || "（添付のみ）", TOKEN_CAP_MESSAGE, now, lineMeta),
      utterance || "（添付のみ）",
      TOKEN_CAP_MESSAGE,
      { task: "利用上限", tools: [], tokensUsed: 0 }
    );
  }

  if (/^読んで[:：]/.test(utterance)) {
    const desk = deskSpeak(withFiles.desk, utterance, now);
    const answer = desk.last?.text ?? desk.notice ?? "そのスキルは無い。";
    return finishSpeak(
      appendExchange({ ...withFiles, desk }, utterance, answer, now, lineMeta),
      utterance,
      answer,
      { task: "スキルを読んでいます", tools: [], tokensUsed: 0 }
    );
  }
  const plan = /^計画して[:：]\s*(.+)$/s.exec(utterance);
  if (plan?.[1]) {
    const verdict = await Promise.resolve(productJev()(plan[1]));
    if (verdict === false) {
      const answer = "保存の意図が確認できなかったため、実行計画は出しません。";
      return finishSpeak(
        appendExchange({ ...withFiles, desk: withoutNotice(withFiles.desk) }, utterance, answer, now, lineMeta),
        utterance,
        answer,
        { task: "実行計画を判定しています", tools: [], tokensUsed: 0 }
      );
    }
    const desk = deskProposePlan(withFiles.desk, plan[1], now, () => verdict);
    const answer = desk.last?.text ?? desk.notice ?? "実行計画を出しました。";
    return finishSpeak(
      appendExchange({ ...withFiles, desk: withoutNotice(desk) }, utterance, answer, now, lineMeta),
      utterance,
      answer,
      { task: "実行計画を出しています", tools: [], tokensUsed: 0 }
    );
  }
  const model = threadModel(withFiles);
  const chat = complete === undefined ? defaultComplete(model) : complete;
  if (!chat) {
    return finishSpeak(
      appendExchange(withFiles, utterance || "（添付のみ）", EMPTY_MODEL_TEXT, now, lineMeta),
      utterance || "（添付のみ）",
      EMPTY_MODEL_TEXT,
      { task: "メッセージを受け付けました", tools: [], tokensUsed: 0 }
    );
  }

  let tokensUsed = 0;
  try {
    const history = activeHistory(withFiles);
    const tools: ToolProgress[] = [];
    const config = loadChatConfig(process.env, model);
    const vision = config ? await describeSpeakAttachments(config, attachments) : { text: null, tokens: 0 };
    tokensUsed += vision.tokens;
    const userText = [utterance, vision.text].filter((part) => part && part.trim()).join("\n\n")
      || "添付資料を確認し、内容に触れて短く答えてください。";
    const turn = await runLiveTurn({
      ledger: withFiles.desk.ledger,
      board: withFiles.desk.board,
      userSkills: withFiles.desk.skills,
      workflows: withFiles.desk.workflows,
      mcpServers: withFiles.desk.mcpServers,
      mcpUserHosts: withFiles.desk.mcpUserHosts,
      domain: withFiles.desk.domain,
      calcs: pack.calcs(withFiles.desk.domain),
      jobs: deskJobs(withFiles.desk),
      registries: withFiles.desk.registries,
      search: productSearch(process.env),
      browser: productBrowserFetch(process.env),
      browserRendered: productRenderedRead(process.env),
      browserSession: adapters.browserSession ?? productBrowserSession(process.env),
      browserOpened: Boolean(withFiles.desk.pendingBrowserHandoff),
      pendingBrowserHandoff: withFiles.desk.pendingBrowserHandoff,
      browserHeldElsewhere: scope.browserHeldElsewhere,
      browserHostAllow: browserHostAllowFromEnv(process.env),
      cliRunner: adapters.cliRunner,
      agentHost: adapters.agentHost,
      mcp: adapters.mcp ?? httpMcpTransport(),
      now,
      userText,
      attachments: attachments.filter((item) => item.media === "application/pdf"),
      history,
      complete: chat,
      jev: productJev(),
      tokensToday,
      tokenCap,
      onTool: (event) => {
        if (event.status !== "running") tools.push(event);
        adapters.onTool?.(event);
      }
    });
    tokensUsed += turn.tokensUsed;
    const answer = speakAnswerText(turn);
    const activities = keepLastBrowserPreview(tools);
    return finishSpeak(
      appendExchange(
        applyTurn(withFiles, turn),
        utterance || "（添付のみ）",
        answer,
        now,
        lineMeta,
        activities,
        turn.uiParts,
        config?.model
      ),
      utterance || "（添付のみ）",
      answer,
      { task: "考えています", tools, tokensUsed }
    );
  } catch (error) {
    const stopText = aiStopText(error);
    const text = stopText ?? MODEL_ERROR_TEXT;
    return finishSpeak(
      appendExchange(withFiles, utterance || "（添付のみ）", text, now, lineMeta, [], [], loadChatConfig(process.env, model)?.model),
      utterance || "（添付のみ）",
      text,
      {
        task: stopText ? "止めました" : "接続に失敗しました",
        tools: [],
        // 失敗前に vision 等で課金済みなら加算する
        tokensUsed
      }
    );
  }
}

function defaultComplete(model?: string): ChatComplete | null {
  const config = loadChatConfig(process.env, model);
  return config ? aiChat(config) : null;
}

async function finishSpeak(
  session: Session,
  userText: string,
  assistantText: string,
  parts: {
    task: string;
    tools: ToolProgress[];
    tokensUsed: number;
    rejected?: DraftSpeak["rejected"];
  }
): Promise<DraftSpeak> {
  const titled = await autoTitleIfNeeded(session, userText, assistantText);
  return {
    task: parts.task,
    tools: parts.tools,
    tokens: chunks(assistantText),
    next: titled.session,
    rejected: parts.rejected ?? null,
    tokensUsed: parts.tokensUsed + titled.tokens
  };
}

/** 手動改名済み・既に名前があるスレッドは触らない。デフォルト名のときだけ安価モデルで一度付ける。 */
async function autoTitleIfNeeded(
  session: Session,
  userText: string,
  assistantText: string
): Promise<{ session: Session; tokens: number }> {
  const thread = session.threads.find((item) => item.id === session.activeThreadId);
  if (!thread || thread.titleLocked || thread.title !== DEFAULT_THREAD_TITLE) {
    return { session, tokens: 0 };
  }
  const config = loadChatConfig(process.env, thread.model);
  const suggested = config
    ? await suggestThreadTitle(config, { userText, assistantText })
    : { title: fallbackThreadTitle(userText), tokens: 0 };
  if (!suggested.title) return { session, tokens: suggested.tokens };
  return {
    session: {
      ...session,
      threads: session.threads.map((item) =>
        item.id === thread.id ? { ...item, title: suggested.title as string } : item
      )
    },
    tokens: suggested.tokens
  };
}

function activeHistory(session: Session): { role: "user" | "assistant"; content: string }[] {
  const thread = session.threads.find((item) => item.id === session.activeThreadId);
  if (!thread) return [];
  return thread.lines.slice(-12).map((line) => ({ role: line.role, content: line.text }));
}

function applyTurn(session: Session, turn: Awaited<ReturnType<typeof runLiveTurn>>): Session {
  const planPending = turn.ledger.planPending;
  return {
    ...session,
    desk: {
      ...session.desk,
      ledger: turn.ledger,
      board: turn.board,
      skills: { ...turn.skills },
      workflows: [...turn.workflows],
      mcpServers: [...turn.mcpServers],
      last: turn,
      pendingPlan: planPending ? (turn.pendingPlan ?? session.desk.pendingPlan) : null,
      pendingDelete: planPending ? turn.pendingDelete : null,
      pendingMcp: planPending ? turn.pendingMcp : null,
      pendingAgentWrite: planPending ? turn.pendingAgentWrite : null,
      pendingBrowserHandoff: turn.pendingBrowserHandoff,
      ...(turn.domain !== undefined ? { domain: turn.domain } : {})
    }
  };
}

const HANDOFF_INSERT_MAX = 2000;

/**
 * handoff 中に確定済み文字列をページへ挿入。
 * Steel Live View は IME composition を扱えないため、日本語はここ経由。
 */
export async function typeBrowserHandoff(
  session: Session,
  raw: string,
  browserSession?: import("agent").BrowserSession
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const pending = currentBrowserHandoff(session);
  if (!pending) return { ok: false, reason: "no_handoff" };
  if (isHandoffExpired(pending, Date.now())) return { ok: false, reason: "expired" };
  if (typeof raw !== "string" || raw.length === 0) return { ok: false, reason: "empty" };
  if (raw.length > HANDOFF_INSERT_MAX) return { ok: false, reason: "too_long" };
  const browser = browserSession ?? productBrowserSession(process.env);
  if (!browser) return { ok: false, reason: "unavailable" };
  try {
    await browser.insertText(raw);
    await browser.detachForHandoff();
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("stale") || message.includes("not_open") || message.includes("closed")) {
      return { ok: false, reason: "stale" };
    }
    return { ok: false, reason: "act_error" };
  }
}

export type BrowserHandoffResolve = {
  outcome: "done" | "failed";
  /** やめたとき／期限切れの任意メモ。 */
  note?: string;
};

/**
 * 「完了／やめる」— pending を外し、同一ブラウザでエージェント再開（fresh snapshot 必須の指示付き）。
 * 再開は引き継ぎを出したスレッドで行う。表示中スレッドは変えない。
 */
export async function completeBrowserHandoff(
  session: Session,
  now: number,
  complete?: ChatComplete | null,
  quota: SpeakQuota = {},
  adapters: SpeakAdapters = {},
  resolve: BrowserHandoffResolve = { outcome: "done" }
): Promise<DraftSpeak> {
  const settled = settleDeskHitl(session, now);
  const viewing = settled.activeThreadId;
  const owner = browserHandoffThreadId(settled) ?? viewing;
  const drafted = await completeBrowserHandoffMounted(
    mountThreadHitl({ ...settled, activeThreadId: owner }, owner),
    now,
    complete,
    quota,
    adapters,
    resolve
  );
  const stowed = stowThreadHitl(drafted.next, owner ?? drafted.next.activeThreadId, now);
  return { ...drafted, next: { ...stowed, activeThreadId: viewing ?? stowed.activeThreadId } };
}

async function completeBrowserHandoffMounted(
  session: Session,
  now: number,
  complete: ChatComplete | null | undefined,
  quota: SpeakQuota,
  adapters: SpeakAdapters,
  resolve: BrowserHandoffResolve
): Promise<DraftSpeak> {
  const pending = session.desk.pendingBrowserHandoff;
  if (!pending) {
    return {
      task: "",
      tools: [],
      tokens: chunks("ブラウザ操作の引き継ぎ待ちはない。"),
      next: {
        ...session,
        desk: { ...session.desk, notice: "ブラウザ操作の引き継ぎ待ちはない。" }
      },
      rejected: null,
      tokensUsed: 0
    };
  }
  const expired = isHandoffExpired(pending, now);
  const outcome = expired ? "failed" : resolve.outcome;
  const note = expired ? "timeout" : resolve.note?.trim() || undefined;
  const localOnly =
    pending.localOnly === true ||
    (typeof pending.liveViewUrl === "string" && pending.liveViewUrl.startsWith("fudo-browser-run:"));
  const userLine = expired
    ? "（引き継ぎ期限切れ）"
    : outcome === "done"
      ? localOnly
        ? "（手元の調査完了）"
        : "（操作完了）"
      : note
        ? `（操作をやめた）${note}`
        : "（操作をやめた）";
  const resumeText = expired
    ? browserHandoffResumeExpired(localOnly)
    : outcome === "done"
      ? localOnly
        ? BROWSER_HANDOFF_RESUME_LOCAL_ONLY_DONE
        : BROWSER_HANDOFF_RESUME_DONE
      : browserHandoffResumeFailed(note, localOnly);

  const cleared = { ...session, desk: deskClearBrowserHandoff(session.desk) };
  const chat = complete === undefined ? defaultComplete(threadModel(session)) : complete;
  if (!chat) {
    return {
      task: "メッセージを受け付けました",
      tools: [],
      tokens: chunks(EMPTY_MODEL_TEXT),
      next: appendExchange(cleared, userLine, EMPTY_MODEL_TEXT, now),
      rejected: null,
      tokensUsed: 0
    };
  }
  const tools: ToolProgress[] = [];
  let turn: Awaited<ReturnType<typeof runLiveTurn>>;
  try {
    turn = await runLiveTurn({
      ledger: cleared.desk.ledger,
      board: cleared.desk.board,
      userSkills: cleared.desk.skills,
      workflows: cleared.desk.workflows,
      mcpServers: cleared.desk.mcpServers,
      mcpUserHosts: cleared.desk.mcpUserHosts,
      domain: cleared.desk.domain,
      calcs: domainPack().calcs(cleared.desk.domain),
      jobs: deskJobs(cleared.desk),
      registries: cleared.desk.registries,
      search: productSearch(process.env),
      browser: productBrowserFetch(process.env),
      browserRendered: productRenderedRead(process.env),
      browserSession: adapters.browserSession ?? productBrowserSession(process.env),
      // localOnly は共有セッションが無い。開けたことにしない。
      browserOpened: !localOnly,
      pendingBrowserHandoff: null,
      browserHostAllow: browserHostAllowFromEnv(process.env),
      cliRunner: adapters.cliRunner,
      agentHost: adapters.agentHost,
      mcp: adapters.mcp ?? httpMcpTransport(),
      now,
      userText: resumeText,
      history: activeHistory(cleared),
      complete: chat,
      jev: productJev(),
      tokensToday: quota.tokensToday ?? 0,
      tokenCap: quota.tokenCap,
      onTool: (event) => {
        if (event.status !== "running") tools.push(event);
        adapters.onTool?.(event);
      }
    });
  } catch (error) {
    const stopText = aiStopText(error);
    const text = stopText ?? MODEL_ERROR_TEXT;
    return {
      task: stopText ? "止めました" : "接続に失敗しました",
      tools: [],
      tokens: chunks(text),
      next: appendExchange(cleared, userLine, text, now),
      rejected: null,
      tokensUsed: 0
    };
  }
  const answer = speakAnswerText(turn);
  return {
    task: "考えています",
    tools,
    tokens: chunks(answer),
    next: appendExchange(
      applyTurn(cleared, turn),
      userLine,
      answer,
      now,
      [],
      keepLastBrowserPreview(tools)
    ),
    rejected: null,
    tokensUsed: turn.tokensUsed
  };
}

export async function saveMcpServer(
  session: Session,
  input: {
    id?: string;
    name?: string;
    url?: string;
    auth?: "none" | "bearer" | "oauth";
    secret?: string;
    catalogId?: string;
    confirmUnknownHost?: boolean;
  }
): Promise<Session> {
  return { ...session, desk: await deskSaveMcp(session.desk, input) };
}

export function removeMcpServer(session: Session, id: string): Session {
  return { ...session, desk: deskRemoveMcp(session.desk, id) };
}

export async function startMcpOAuth(
  session: Session,
  input: { catalogId?: string; name?: string; url?: string },
  redirectUri: string,
  publicOrigin: string
): Promise<{ session: Session; authorizeUrl: string } | { session: Session; error: string }> {
  const entry = input.catalogId ? catalogById(input.catalogId) : undefined;
  const name = (input.name ?? entry?.name ?? "").trim();
  const mcpUrl = (input.url ?? entry?.url ?? "").trim();
  if (!name || !mcpUrl) {
    return {
      session: { ...session, desk: withAbilityNotice(session.desk, "接続先が要る") },
      error: "missing_target"
    };
  }
  const existing = session.desk.mcpServers.find(
    (server) =>
      (input.catalogId && server.catalogId === input.catalogId) ||
      server.id === (input.catalogId ?? entry?.id) ||
      server.url === mcpUrl
  );
  const started = await beginMcpOAuthFlow({
    mcpUrl,
    name,
    catalogId: input.catalogId ?? entry?.id,
    redirectUri,
    publicOrigin,
    ...(existing?.reauthScope ? { extraScope: existing.reauthScope } : {})
  });
  if (!started.ok) {
    const canBearer = entry?.auth.includes("bearer") === true;
    // registration_unsupported + Bearer 可は UI がトークン入力へ。技術理由は出さない。
    if (started.reason === "registration_unsupported") {
      return {
        session: {
          ...session,
          desk: withAbilityNotice(
            session.desk,
            canBearer ? null : "この接続には製品側の OAuth クライアント設定が必要"
          )
        },
        error: started.reason
      };
    }
    // Figma 等: DCR が allowlist で 403。事前 client／カタログ承認が要る。
    if (started.reason.startsWith("registration_http_") && !canBearer) {
      return {
        session: {
          ...session,
          desk: withAbilityNotice(session.desk, "この MCP は製品の事前登録（ベンダー承認）が必要")
        },
        error: started.reason
      };
    }
    return {
      session: {
        ...session,
        desk: withAbilityNotice(session.desk, `接続を開始できない（${started.reason}）`)
      },
      error: started.reason
    };
  }
  return {
    session: { ...session, desk: deskSetPendingMcpOAuth(session.desk, started.pending) },
    authorizeUrl: started.authorizeUrl
  };
}

export async function completeMcpOAuth(
  session: Session,
  query: { code?: string; state?: string; error?: string; error_description?: string }
): Promise<{ session: Session; redirectOrigin: string }> {
  const pending = session.desk.pendingMcpOAuth;
  const fallbackOrigin = "http://127.0.0.1:4174";
  if (!pending) {
    return {
      session: { ...session, desk: deskFailMcpOAuth(session.desk, "OAuth 待ちがない") },
      redirectOrigin: fallbackOrigin
    };
  }
  const origin = pending.publicOrigin || fallbackOrigin;
  if (query.error) {
    return {
      session: {
        ...session,
        desk: deskFailMcpOAuth(session.desk, query.error_description || query.error || "認可が拒否された")
      },
      redirectOrigin: origin
    };
  }
  if (!query.code || !query.state) {
    return {
      session: { ...session, desk: deskFailMcpOAuth(session.desk, "認可コードが無い") },
      redirectOrigin: origin
    };
  }
  const finished = await finishMcpOAuthFlow({
    pending,
    code: query.code,
    state: query.state
  });
  if (!finished.ok) {
    return {
      session: { ...session, desk: deskFailMcpOAuth(session.desk, `接続に失敗した（${finished.reason}）`) },
      redirectOrigin: origin
    };
  }
  return {
    session: { ...session, desk: await deskCompleteMcpOAuth(session.desk, finished.secret) },
    redirectOrigin: origin
  };
}

/** 一過性 Banner / 行フィードバックを閉じる。scope 省略時は両方。id 指定で MCP 行の lastProbe だけ消せる。 */
export function dismissNotice(
  session: Session,
  scope: "notice" | "ability" | "all" = "all",
  id?: string
): Session {
  const desk = session.desk;
  if (scope === "notice") {
    return desk.notice === null ? session : { ...session, desk: { ...desk, notice: null } };
  }
  if (scope === "ability") {
    return {
      ...session,
      desk: clearAbilityFeedback(desk, id)
    };
  }
  return {
    ...session,
    desk: {
      ...clearAbilityFeedback(desk, id),
      notice: null
    }
  };
}

function clearAbilityFeedback(desk: Desk, id?: string): Desk {
  const servers = id
    ? desk.mcpServers.map((server) =>
        server.id === id && server.lastProbe ? { ...server, lastProbe: undefined } : server
      )
    : desk.mcpServers.map((server) =>
        server.lastProbe ? { ...server, lastProbe: undefined } : server
      );
  return {
    ...desk,
    abilityNotice: id ? desk.abilityNotice : null,
    mcpServers: servers
  };
}

function withMcpLastProbe(
  desk: Desk,
  id: string,
  lastProbe: { ok: boolean; detail: string; at: number; tools?: string[] },
  serverPatch?: McpServer,
  listedTools?: string[]
): Desk {
  return {
    ...desk,
    // 行内表示に移したので上部 abilityNotice は使わない
    abilityNotice: null,
    notice:
      desk.notice !== null && isAbilityScopedNotice(desk.notice) ? null : desk.notice,
    mcpServers: desk.mcpServers.map((item) => {
      if (item.id !== id) {
        return item.lastProbe ? { ...item, lastProbe: undefined } : item;
      }
      const base = serverPatch ?? item;
      return {
        ...base,
        lastProbe,
        ...(listedTools !== undefined ? { listedTools } : {})
      };
    })
  };
}

/** 能力ペインの接続試験。結果は行内 lastProbe＋設定用 listedTools（上部 Banner に出さない）。 */
export async function probeMcpServer(
  session: Session,
  id: string,
  transport?: McpTransport
): Promise<Session> {
  const server = session.desk.mcpServers.find((item) => item.id === id);
  if (!server) {
    return { ...session, desk: withAbilityNotice(session.desk, "MCP が見つからない") };
  }
  const probed = await probeMcp(server, transport ?? httpMcpTransport());
  const at = Date.now();
  if (!probed.ok) {
    return {
      ...session,
      desk: withMcpLastProbe(
        session.desk,
        id,
        { ok: false, detail: formatMcpProbeReason(probed.reason), at },
        probed.server
      )
    };
  }
  // 行フィードバックは件数。ツール名は listedTools に残し、lastProbe 消去後もダイアログで見える。
  const detail =
    probed.tools.length > 0 ? `${probed.tools.length}ツール` : "ツールなし";
  return {
    ...session,
    desk: withMcpLastProbe(
      session.desk,
      id,
      { ok: true, detail, at },
      probed.server,
      probed.tools
    )
  };
}

export function viewOf(raw: Session, usage: ViewUsage = {}): unknown {
  const session = settleDeskHitl(raw, Date.now());
  const snap = snapshot(session.desk) as {
    notice: string | null;
    cards: unknown;
    skills: unknown;
    workflows: unknown;
    posts: string[];
    ran: string[];
    last: unknown;
    planPending: boolean;
    pendingPlan: string | null;
    pendingDelete: { kind: string; id: string } | null;
    pendingMcp: unknown;
    pendingBrowserHandoff: {
      reason: string;
      task?: string;
      liveViewUrl: string;
      createdAt: number;
      expiresAt: number;
    } | null;
    mcpServers: unknown;
    mcpCatalog: unknown;
    mcpUserHosts: string[];
    mcpHostAllow: string[];
    cliAllow: string[];
    notes: unknown;
    memos: unknown;
    jobs: string[];
  };
  const active = session.threads.find((thread) => thread.id === session.activeThreadId) ?? null;
  const hitl = active?.hitl ?? null;
  const tokenCap = usage.tokenCap !== undefined ? usage.tokenCap : resolveDailyTokenCap(process.env);
  const tokensToday = usage.tokensToday ?? 0;
  return {
    model: chatModelFor(process.env, active?.model),
    modelChoices: [
      ...(CHAT_MODEL_CHOICES.some((choice) => choice.id === deploymentChatModel(process.env))
        ? []
        : [{ id: deploymentChatModel(process.env), label: deploymentChatModel(process.env), images: false, billing: "gateway" as const }]),
      ...CHAT_MODEL_CHOICES
    ],
    localOnly: true,
    home: false,
    ...viewNotices(session.desk),
    tokensToday,
    tokenCap,
    tokenCapReached: isDailyTokenCapReached(tokensToday, tokenCap),
    tokenCapMessage: TOKEN_CAP_MESSAGE,
    threads: [...session.threads].sort((left, right) => right.updatedAt - left.updatedAt).map((thread) => ({
      id: thread.id,
      title: thread.title,
      updatedAt: thread.updatedAt,
      awaiting: thread.browserHandoff ? "handoff" : thread.hitl ? "approval" : null
    })),
    activeThreadId: session.activeThreadId,
    lines: active?.lines ?? [],
    cards: snap.cards,
    skills: snap.skills,
    workflows: snap.workflows,
    posts: snap.posts,
    ran: snap.ran,
    last: snap.last,
    planPending: hitl !== null,
    pendingPlan: hitl?.pendingPlan ?? null,
    pendingDelete: hitl?.pendingDelete ?? null,
    pendingMcp: hitl?.pendingMcp ?? null,
    pendingAgentWrite: hitl?.pendingAgentWrite ?? null,
    pendingBrowserHandoff: active?.browserHandoff ?? null,
    mcpServers: snap.mcpServers ?? [],
    mcpCatalog: snap.mcpCatalog ?? [],
    agentCatalog: (snap as { agentCatalog?: unknown }).agentCatalog ?? [],
    agentAllow: (snap as { agentAllow?: unknown }).agentAllow ?? [],
    mcpUserHosts: snap.mcpUserHosts ?? [],
    mcpHostAllow: snap.mcpHostAllow ?? [],
    cliAllow: snap.cliAllow ?? [],
    notes: snap.notes,
    memos: snap.memos,
    jobs: snap.jobs,
    ...(domainPack().view?.(session.desk) ?? {})
  };
}

function appendAssistantWithUi(
  session: Session,
  text: string,
  now: number,
  activities: ToolProgress[],
  ui: UiPart[]
): Session {
  const thread = ensureThread(session, now);
  const assistantLine: ThreadLine = {
    role: "assistant",
    text,
    ...(activities.length > 0 ? { activities } : {}),
    ...(ui.length > 0 ? { ui } : {})
  };
  const updated = { ...thread, lines: [...thread.lines, assistantLine], updatedAt: now };
  return {
    ...session,
    activeThreadId: updated.id,
    threads: upsert(session.threads, updated),
    seq: Math.max(session.seq, numberOf(updated.id))
  };
}

function withoutNotice(desk: Desk): Desk {
  return desk.notice === null ? desk : { ...desk, notice: null };
}

function withAbilityNotice(desk: Desk, abilityNotice: string | null): Desk {
  // 能力向けメッセージを卓の汎用 notice から外し、スレッドに残さない。
  const cleared =
    desk.notice !== null && isAbilityScopedNotice(desk.notice)
      ? { ...desk, notice: null }
      : desk;
  return { ...cleared, abilityNotice };
}

function isAbilityScopedNotice(text: string): boolean {
  return /^(接続 OK|接続失敗|接続先が要る|接続を開始できない|この MCP |MCP が見つからない|この接続には)/.test(
    text.trim()
  );
}

/** 旧セッションで卓 notice に残った能力メッセージを能力欄へ移し、ツール名ダンプを要約する。 */
function viewNotices(desk: Desk): { notice: string | null; abilityNotice: string | null } {
  let notice = desk.notice;
  let abilityNotice = desk.abilityNotice;
  if (!abilityNotice && notice && isAbilityScopedNotice(notice)) {
    abilityNotice = notice;
    notice = null;
  }
  if (abilityNotice) abilityNotice = summarizeAbilityNotice(abilityNotice);
  return { notice, abilityNotice };
}

function summarizeAbilityNotice(text: string): string {
  const m = text.trim().match(/^接続 OK[（(](.+)[）)]\s*$/);
  if (!m) return text;
  const inner = m[1]!.trim();
  if (inner === "ツールなし") return "接続 OK · ツールなし";
  if (/^\d+ツール$/.test(inner)) return `接続 OK · ${inner}`;
  if (/^ツール \d+$/.test(inner)) {
    const n = inner.replace(/^ツール\s*/, "");
    return `接続 OK · ${n}ツール`;
  }
  // 旧: ツール名を · 連結していた形式
  if (inner.includes("_") || inner.includes(" · ")) {
    const n = inner.split(/\s*·\s*/).filter(Boolean).length;
    return `接続 OK · ${n}ツール`;
  }
  return text;
}

function appendExchange(
  session: Session,
  user: string,
  assistant: string,
  now: number,
  attachments: { name: string; media: string }[] = [],
  activities: ToolProgress[] = [],
  ui: UiPart[] = [],
  model?: string
): Session {
  const thread = ensureThread(session, now);
  const userLine: ThreadLine = attachments.length > 0
    ? { role: "user", text: user, attachments }
    : { role: "user", text: user };
  const assistantLine: ThreadLine = {
    role: "assistant",
    text: assistant,
    ...(activities.length > 0 ? { activities } : {}),
    ...(ui.length > 0 ? { ui } : {}),
    ...(model ? { model } : {})
  };
  const lines = [...thread.lines, userLine, assistantLine];
  const updated = { ...thread, lines, updatedAt: now };
  return {
    ...session,
    activeThreadId: updated.id,
    threads: upsert(session.threads, updated),
    seq: Math.max(session.seq, numberOf(updated.id))
  };
}

function appendAssistant(session: Session, text: string, now: number): Session {
  const thread = ensureThread(session, now);
  const updated = { ...thread, lines: [...thread.lines, { role: "assistant" as const, text }], updatedAt: now };
  return { ...session, activeThreadId: updated.id, threads: upsert(session.threads, updated) };
}

function ensureThread(session: Session, now: number): Thread {
  const found = session.threads.find((thread) => thread.id === session.activeThreadId);
  if (found) return found;
  return { id: `t${session.seq + 1}`, title: DEFAULT_THREAD_TITLE, titleLocked: false, updatedAt: now, lines: [] };
}

function upsert(threads: Thread[], thread: Thread): Thread[] {
  const rest = threads.filter((item) => item.id !== thread.id);
  return [...rest, thread];
}

function numberOf(id: string): number {
  const value = Number(id.slice(1));
  return Number.isFinite(value) ? value : 0;
}

export function chunks(text: string): string[] {
  const size = 12;
  const parts: string[] = [];
  for (let index = 0; index < text.length; index += size) parts.push(text.slice(index, index + size));
  return parts.length > 0 ? parts : [""];
}
