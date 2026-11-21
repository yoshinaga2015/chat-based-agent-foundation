import {
  Banner,
  Badge,
  Button,
  Checkbox,
  Collapsible,
  Dialog,
  DropdownMenu,
  Empty,
  InputArea,
  LayerCard,
  Link,
  Loader,
  Select,
  Sidebar,
  Tabs,
  Text,
  useSidebar
} from "@cloudflare/kumo";
import {
  BrowserIcon,
  CaretDownIcon,
  CircleDashedIcon,
  ClockIcon,
  CodeIcon,
  DotsSixVerticalIcon,
  FlowArrowIcon,
  HourglassMediumIcon,
  KanbanIcon,
  DesktopIcon,
  GlobeIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  NotebookIcon,
  NoteIcon,
  PaperclipIcon,
  PaperPlaneTiltIcon,
  PlugsConnectedIcon,
  PlayIcon,
  PlusIcon,
  SealCheckIcon,
  SidebarSimpleIcon,
  SparkleIcon,
  StopIcon,
  SunIcon,
  TerminalWindowIcon,
  CalculatorIcon,
  FileTextIcon,
  ListChecksIcon,
  XIcon
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode
} from "react";
import {
  MCP_FREE_BEARER_HINT,
  SPEAK_ATTACH_MAX_BYTES,
  type ActivityKind,
  type McpBearerHint,
  type ToolProgress
} from "agent";
import {
  fileToSpeakAttach,
  getSession,
  openBrowserHandoffComplete,
  openSpeak,
  openSpeakStream,
  postBrowserHandoffType,
  postJson,
  readEvents,
  documentHref,
  listDocuments,
  listDocumentVersions,
  startMcpOAuthConnect,
  uploadDocument,
  type DocumentView,
  type SpeakAttachPayload
} from "./api";
import { ChatMarkdown } from "./ChatMarkdown";
import { abilityStatusBadge, mcpConnectionStatus, type AbilityStatus } from "./abilityStatus";
import { noticeBannerVariant } from "./noticeBanner";
import { BrowserHandoffBar, formatBytes, isHandoffTaskEcho, PlanHitlBanner } from "./ui/hitl";
import { DismissibleNoticeBanner } from "./ui/noticeBanner";
import { McpConfigureDialog } from "./ui/mcpConfigureDialog";
import { pickSelectionText, placeSelectionText } from "./ui/parts";
import { DashboardGallery, readDashboardGalleryQuery } from "./ui/DashboardGallery";
import { FormsGallery, clearGallerySearchParam, readFormsGalleryQuery } from "./ui/FormsGallery";
import { UiSurfaceError, UiSurfacePending } from "./ui/UiSurfacePending";
import { renderUiParts } from "./ui/registry";
import { FormInput, FormInputArea, FormSelect } from "./fields";
import { FileDropZone } from "./FileDrop";
import { hasMcpServiceMark, mcpServiceMark } from "./mcp-logos";
import { shouldClearClientProgressOnStreamEnd } from "./progress-owner";
import {
  applyStatusProgress,
  applyTokenProgress,
  applyToolProgress,
  emptySpeakProgress,
  finishSpeakProgress,
  runningThreadIds as listRunningThreadIds,
  startSpeakProgress,
  visibleSpeakProgress,
  type ThreadSpeakProgress
} from "./speakThreadProgress";
import {
  clearReloadedFlag,
  reloadPhase,
  setRestoreProvider,
  subscribeReloadPhase,
  takeRestoreState,
  type ReloadPhase
} from "./stale-build";
import {
  applyColorPreference,
  colorPreferenceLabel,
  nextColorPreference,
  readColorPreference,
  type ColorPreference
} from "./color-mode";
import { readDeveloperMode, writeDeveloperMode } from "./developer-mode";
import {
  CARD_STATES,
  type CardView,
  type FormValue,
  type MemoView,
  type NoteView,
  type Pane,
  type ProductView,
  type SkillView,
  type ThreadLine,
  type ChatModelChoice,
  type WorkflowView
} from "./types";

const ATTACH_HINT = "PDF / PNG / JPEG、1件、3MBまで";
const CARD_DRAG = "application/x-fudo-card";

type QueuedSpeak = {
  text: string;
  attach: SpeakAttachPayload | null;
};

export function App() {
  const restored = useRef(takeRestoreState());
  const [view, setView] = useState<ProductView | null>(null);
  const [pane, setPane] = useState<Pane>(() => {
    const fromQuery = new URLSearchParams(window.location.search).get("pane");
    if (fromQuery === "ability" || fromQuery === "kanban" || fromQuery === "chat") {
      const url = new URL(window.location.href);
      url.searchParams.delete("pane");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
      return fromQuery;
    }
    return restored.current?.pane ?? "chat";
  });
  const [colorPreference, setColorPreference] = useState<ColorPreference>(() => readColorPreference());
  const [developerMode, setDeveloperMode] = useState(() => readDeveloperMode());
  const [dashboardGallery, setDashboardGallery] = useState(
    () => readDeveloperMode() && readDashboardGalleryQuery()
  );
  const [formsGallery, setFormsGallery] = useState(() => readDeveloperMode() && readFormsGalleryQuery());
  function leaveGallery() {
    if (!dashboardGallery && !formsGallery) return;
    setDashboardGallery(false);
    setFormsGallery(false);
    clearGallerySearchParam();
  }
  const [draft, setDraft] = useState(() => restored.current?.draft ?? "");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [live, setLive] = useState("");
  const [attach, setAttach] = useState<SpeakAttachPayload | null>(null);
  const [tools, setTools] = useState<ToolProgress[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [speakQueue, setSpeakQueue] = useState<QueuedSpeak | null>(null);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [buildPhase, setBuildPhase] = useState<ReloadPhase>(() => reloadPhase());
  const [composerFocusNonce, setComposerFocusNonce] = useState(0);
  const speakGen = useRef(0);
  const speakAbort = useRef<AbortController | null>(null);
  const speakThreadIdRef = useRef<string | null>(null);
  const speakByThreadRef = useRef(new Map<string, ThreadSpeakProgress>());
  /** サーバー view 反映前でも「今見ているスレッド」を先に切る。 */
  const viewingThreadIdRef = useRef<string | null>(null);
  const [runningThreads, setRunningThreads] = useState<string[]>([]);
  const viewRef = useRef<ProductView | null>(null);
  const width = storedWidth();

  useEffect(() => {
    viewRef.current = view;
    viewingThreadIdRef.current = view?.activeThreadId ?? null;
  }, [view]);

  useEffect(() => {
    applyColorPreference(colorPreference);
    if (colorPreference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyColorPreference("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [colorPreference]);

  useEffect(() => {
    clearReloadedFlag();
    void getSession().then((next) => {
      setView(next);
      viewingThreadIdRef.current = next.activeThreadId;
      if (next.activeSpeak?.runId) {
        void resumeSpeakRun(next.activeSpeak.runId, next.activeSpeak.threadId);
      }
    });
  }, []);

  useEffect(() => {
    return setRestoreProvider(() => ({ pane, draft }));
  }, [pane, draft]);

  useEffect(() => subscribeReloadPhase(() => setBuildPhase(reloadPhase())), []);

  useEffect(() => {
    return () => {
      // SSE 購読だけ切る。サーバー run は止めない（Stop は /api/interrupt）。
      speakAbort.current?.abort();
      speakAbort.current = null;
    };
  }, []);

  function publishRunningThreads() {
    setRunningThreads(listRunningThreadIds(speakByThreadRef.current));
  }

  function mirrorVisibleProgress(threadId: string | null) {
    const next = visibleSpeakProgress(speakByThreadRef.current, threadId);
    setTools(next.tools);
    setStatus(next.status);
    setLive(next.live);
    setSpeaking(next.speaking);
  }

  function patchSpeakThread(
    threadId: string | null,
    update: (prev: ThreadSpeakProgress) => ThreadSpeakProgress
  ) {
    if (!threadId) {
      const next = update(emptySpeakProgress());
      setTools(next.tools);
      setStatus(next.status);
      setLive(next.live);
      setSpeaking(next.speaking);
      return next;
    }
    const prev = speakByThreadRef.current.get(threadId) ?? emptySpeakProgress();
    const next = update(prev);
    speakByThreadRef.current.set(threadId, next);
    publishRunningThreads();
    if (viewingThreadIdRef.current === threadId) {
      setTools(next.tools);
      setStatus(next.status);
      setLive(next.live);
      setSpeaking(next.speaking);
    }
    return next;
  }

  function clearSpeakThread(threadId: string | null) {
    if (threadId) {
      speakByThreadRef.current.delete(threadId);
      publishRunningThreads();
    }
    if (!threadId || viewingThreadIdRef.current === threadId) {
      setTools([]);
      setStatus("");
      setLive("");
      setSpeaking(false);
    }
  }

  /** 表示スレッドを変える。バックグラウンド speak は止めず、進捗はキャッシュから復元。 */
  function showThreadProgress(threadId: string | null) {
    viewingThreadIdRef.current = threadId;
    mirrorVisibleProgress(threadId);
  }

  async function attachSpeakStream(
    response: Response,
    originThreadId: string | null,
    mine: number
  ): Promise<void> {
    let spoken = "";
    let receivedDone = false;
    let threadId = originThreadId;
    try {
      await readEvents(response, (name, data) => {
        if (mine !== speakGen.current) return;
        if (
          name === "run" &&
          data &&
          typeof data === "object" &&
          "threadId" in data &&
          typeof (data as { threadId: unknown }).threadId === "string"
        ) {
          threadId = (data as { threadId: string }).threadId;
          speakThreadIdRef.current = threadId;
        }
        if (name === "status" && data && typeof data === "object" && "text" in data) {
          patchSpeakThread(threadId, (prev) => applyStatusProgress(prev, String(data.text)));
        }
        if (name === "tool" && data && typeof data === "object" && "id" in data && "label" in data) {
          patchSpeakThread(threadId, (prev) => applyToolProgress(prev, data as ToolProgress));
        }
        if (name === "token" && data && typeof data === "object" && "text" in data) {
          spoken += String(data.text);
          patchSpeakThread(threadId, (prev) => applyTokenProgress(prev, spoken));
        }
        if (name === "done" && data && typeof data === "object" && "view" in data) {
          receivedDone = true;
          const interrupted = "interrupted" in data && Boolean(data.interrupted);
          patchSpeakThread(threadId, () => finishSpeakProgress(interrupted));
          if (!interrupted) clearSpeakThread(threadId);
          const nextView = data.view as ProductView | null;
          if (nextView) {
            setView(nextView);
            showThreadProgress(nextView.activeThreadId);
          }
        }
      });
    } catch {
      // abort / 切断 — run はサーバー側で継続
    }
    if (mine !== speakGen.current) return;
    if (shouldClearClientProgressOnStreamEnd(receivedDone)) {
      // 購読切断だけではキャッシュを消さない（resume 用）。明示 Stop / 新 speak が消す。
    }
  }

  async function resumeSpeakRun(runId: string, threadId: string | null) {
    const prevOrigin = speakThreadIdRef.current;
    speakAbort.current?.abort();
    if (prevOrigin && prevOrigin !== threadId) clearSpeakThread(prevOrigin);
    const abort = new AbortController();
    speakAbort.current = abort;
    const mine = ++speakGen.current;
    speakThreadIdRef.current = threadId;
    patchSpeakThread(threadId, () => startSpeakProgress("再開しています…"));
    setPane("chat");
    let response: Response;
    try {
      response = await openSpeakStream(runId, { signal: abort.signal });
    } catch {
      if (mine !== speakGen.current) return;
      clearSpeakThread(threadId);
      return;
    }
    if (mine !== speakGen.current) return;
    if (!response.ok) {
      clearSpeakThread(threadId);
      return;
    }
    await attachSpeakStream(response, threadId, mine);
  }

  async function send(text: string, payload: SpeakAttachPayload | null) {
    const utterance = text.trim();
    if (!utterance && !payload) return;
    if (utterance.length > 20_000) {
      setError("メッセージは2万字までです");
      return;
    }
    const prevOrigin = speakThreadIdRef.current;
    speakAbort.current?.abort();
    const abort = new AbortController();
    speakAbort.current = abort;
    const mine = ++speakGen.current;
    const originThreadId = viewRef.current?.activeThreadId ?? null;
    if (prevOrigin && prevOrigin !== originThreadId) clearSpeakThread(prevOrigin);
    speakThreadIdRef.current = originThreadId;
    setError("");
    setDraft("");
    setAttach(null);
    setSpeakQueue(null);
    patchSpeakThread(originThreadId, () => startSpeakProgress());
    setPane("chat");
    let beforeSend: ProductView | null = null;
    setView((current) => {
      beforeSend = current;
      if (!current) return current;
      const line: ThreadLine = {
        role: "user",
        text: utterance || "（添付のみ）",
        ...(payload ? { attachments: [{ name: payload.name, media: payload.media }] } : {})
      };
      return { ...current, lines: [...current.lines, line] };
    });
    let response: Response;
    try {
      response = await openSpeak(utterance, payload ? [payload] : [], { signal: abort.signal });
    } catch {
      if (mine !== speakGen.current) return;
      clearSpeakThread(originThreadId);
      if (!abort.signal.aborted) setError("送信に失敗しました");
      return;
    }
    if (mine !== speakGen.current) return;
    if (!response.ok) {
      setView(beforeSend);
      clearSpeakThread(originThreadId);
      const body = await response.json().catch(() => ({})) as { reason?: string };
      setError(speakError(body.reason) || "メッセージは2万字までです");
      return;
    }
    await attachSpeakStream(response, originThreadId, mine);
  }

  async function completeHandoff(outcome: "done" | "failed" = "done") {
    const prevOrigin = speakThreadIdRef.current;
    speakAbort.current?.abort();
    const abort = new AbortController();
    speakAbort.current = abort;
    const mine = ++speakGen.current;
    const originThreadId = viewRef.current?.activeThreadId ?? null;
    if (prevOrigin && prevOrigin !== originThreadId) clearSpeakThread(prevOrigin);
    speakThreadIdRef.current = originThreadId;
    setError("");
    patchSpeakThread(originThreadId, () => startSpeakProgress());
    setPane("chat");
    let response: Response;
    try {
      response = await openBrowserHandoffComplete({ signal: abort.signal, outcome });
    } catch {
      if (mine !== speakGen.current) return;
      clearSpeakThread(originThreadId);
      if (!abort.signal.aborted) setError("再開に失敗しました");
      return;
    }
    if (mine !== speakGen.current) return;
    if (!response.ok) {
      clearSpeakThread(originThreadId);
      setError("再開に失敗しました");
      return;
    }
    await attachSpeakStream(response, originThreadId, mine);
  }

  function enqueueOrSend() {
    const utterance = draft.trim();
    if (!utterance && !attach) {
      if (speakQueue) void send(speakQueue.text, speakQueue.attach);
      return;
    }
    if (utterance.length > 20_000) {
      setError("メッセージは2万字までです");
      return;
    }
    if (speaking) {
      setSpeakQueue({ text: utterance, attach });
      setDraft("");
      setAttach(null);
      setError("");
      return;
    }
    void send(utterance, attach);
  }

  async function stopSpeaking() {
    const origin = speakThreadIdRef.current;
    const active = speaking || (origin != null && speakByThreadRef.current.get(origin)?.speaking);
    if (!active) return;
    speakAbort.current?.abort();
    speakAbort.current = null;
    speakGen.current += 1;
    clearSpeakThread(origin);
    setStatus("停止しました");
    try {
      const next = await postJson("/api/interrupt", {});
      setView(next);
      showThreadProgress(next.activeThreadId);
    } catch {
      // クライアント側は既に止めた。サーバー世代更新に失敗しても続行可。
    }
  }

  function onDraftKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      enqueueOrSend();
    }
  }

  return (
    <Sidebar.Provider
      className="h-dvh"
      defaultOpen
      resizable
      minWidth={192}
      maxWidth={384}
      defaultWidth={width}
      mobileBreakpoint={760}
      onWidthChange={(next) => localStorage.setItem("nav-width", String(next))}
    >
      <Sidebar>
        <Sidebar.Header>
          <div className="px-2"><Text variant="heading" as="p">fudo</Text></div>
          <MobileSidebarClose />
        </Sidebar.Header>
        <Sidebar.Content>
          <SidebarThreadList
            pane={pane}
            threads={view?.threads ?? []}
            activeThreadId={view?.activeThreadId ?? null}
            runningThreadIds={runningThreads}
            editingThreadId={editingThreadId}
            onEditingThreadId={setEditingThreadId}
            onPane={setPane}
            onView={(next) => {
              setView(next);
              showThreadProgress(next.activeThreadId);
            }}
            onLeaveGallery={leaveGallery}
            onShowThreadProgress={showThreadProgress}
            onNewThread={() => setComposerFocusNonce((n) => n + 1)}
          />
        </Sidebar.Content>
        <Sidebar.Footer>
          <SidebarPaneButtons
            pane={pane}
            colorPreference={colorPreference}
            developerMode={developerMode}
            onPane={(next) => {
              leaveGallery();
              setPane(next);
            }}
            onColorPreference={() => setColorPreference((current) => nextColorPreference(current))}
            onDeveloperMode={() => {
              setDeveloperMode((on) => {
                const next = !on;
                writeDeveloperMode(next);
                if (!next) {
                  setDashboardGallery(false);
                  setFormsGallery(false);
                  clearGallerySearchParam();
                }
                return next;
              });
            }}
          />
          <Sidebar.Trigger className="ml-auto">
            <SidebarSimpleIcon size={16} aria-hidden />
          </Sidebar.Trigger>
        </Sidebar.Footer>
      </Sidebar>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-kumo-base">
        <MobileSidebarOpen />
        {buildPhase === "failed" ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-kumo-line px-5 py-3">
            <Text size="sm" as="p">
              この画面は古くなっています
            </Text>
            <Button size="sm" variant="primary" type="button" onClick={() => globalThis.location.reload()}>
              再読み込み
            </Button>
          </div>
        ) : null}
        {!view && !dashboardGallery && !formsGallery ? (
          <Loader />
        ) : dashboardGallery ? (
          <DashboardGallery />
        ) : formsGallery ? (
          <FormsGallery />
        ) : pane === "chat" ? (
          <ChatPane
            lines={view!.lines}
            cards={view!.cards}
            live={live}
            status={status}
            tools={tools}
            speaking={speaking}
            notice={view!.notice}
            tokenCapReached={view!.tokenCapReached}
            tokenCapMessage={view!.tokenCapMessage}
            planPending={view!.planPending}
            pendingPlan={view!.pendingPlan}
            pendingDelete={view!.pendingDelete}
            pendingMcp={view!.pendingMcp}
            pendingAgentWrite={view!.pendingAgentWrite}
            pendingBrowserHandoff={view!.pendingBrowserHandoff}
            draft={draft}
            error={error}
            attach={attach}
            speakQueue={speakQueue}
            last={view!.last}
            focusNonce={composerFocusNonce}
            model={view!.model}
            modelChoices={view!.modelChoices ?? []}
            onModel={(model) => {
              const threadId = view!.activeThreadId;
              const target = threadId
                ? Promise.resolve(threadId)
                : postJson("/api/thread", {}).then((next) => next.activeThreadId);
              void target.then(async (id) => {
                if (!id) return;
                const next = await postJson("/api/thread", { id, model });
                if (Array.isArray(next.threads)) setView(next);
                else setError("このモデルは選べません");
              });
            }}
            onDraft={setDraft}
            onKeyDown={onDraftKey}
            onSend={enqueueOrSend}
            onStop={() => {
              void stopSpeaking();
            }}
            onSendNow={() => {
              if (!speakQueue) return;
              void send(speakQueue.text, speakQueue.attach);
            }}
            onClearQueue={() => setSpeakQueue(null)}
            onDismissNotice={() => {
              void postJson("/api/notice", { scope: "notice" }).then(setView);
            }}
            onPlan={(decision) => {
              // 削除 HITL は承認時に卓が適用済み。「続けて。」だと再削除して見つからないと誤る。
              const skipContinue = decision === "approve" && (view!.pendingDelete !== null || view!.pendingMcp !== null);
              void postJson("/api/plan", { decision, threadId: view!.activeThreadId }).then((next) => {
                setView(next);
                if (decision === "approve" && !skipContinue) void send("続けて。", null);
              });
            }}
            onPick={(text) => {
              void send(text, null);
            }}
            onFormCommit={(values, speakSummary) => {
              if (speakSummary) {
                void send(`前提を更新します。${speakSummary}`, null);
                return;
              }
              void postJson("/api/assumptions", values).then(setView);
            }}
            onBrowserHandoffComplete={(outcome) => {
              void completeHandoff(outcome ?? "done");
            }}
            onBrowserHandoffType={async (value) => {
              await postBrowserHandoffType(value);
            }}
            onAttach={async (file) => {
              if (!file) {
                setAttach(null);
                return;
              }
              if (file.size > SPEAK_ATTACH_MAX_BYTES) {
                setError(`ファイルが大きすぎます（${ATTACH_HINT}）`);
                return;
              }
              const next = await fileToSpeakAttach(file);
              if (!next) {
                setError(`この形式は添付できません（${ATTACH_HINT}）`);
                return;
              }
              setError("");
              setAttach(next);
            }}
            onClearAttach={() => setAttach(null)}
          />
        ) : pane === "kanban" ? (
          <KanbanPane cards={view.cards} notice={view.notice} onChange={setView} />
        ) : (
          <AbilityPane
            skills={view.skills}
            workflows={view.workflows}
            posts={view.posts}
            ran={view.ran}
            notes={view.notes}
            memos={view.memos}
            jobs={view.jobs}
            mcpServers={view.mcpServers ?? []}
            mcpCatalog={view.mcpCatalog ?? []}
            mcpHostAllow={view.mcpHostAllow ?? []}
            cliAllow={view.cliAllow ?? []}
            documentsEnabled={view?.documentsEnabled === true}
            capabilityGaps={view.capabilityGaps ?? []}
            notice={view.abilityNotice}
            developerMode={developerMode}
            onChange={setView}
          />
        )}
      </main>
    </Sidebar.Provider>
  );
}

function storedWidth(): number {
  const stored = Number(localStorage.getItem("nav-width"));
  return stored >= 192 && stored <= 384 ? stored : 256;
}

function speakError(reason: string | undefined): string {
  if (reason === "too_many") return `添付は1件までです（${ATTACH_HINT}）`;
  if (reason === "too_large") return `ファイルが大きすぎます（${ATTACH_HINT}）`;
  if (reason === "bad_media" || reason === "bad_payload") return `この形式は添付できません（${ATTACH_HINT}）`;
  return "";
}

function useCloseMobileDrawer() {
  const { isMobile, setOpenMobile } = useSidebar();
  return () => {
    if (isMobile) setOpenMobile(false);
  };
}

function MobileSidebarOpen() {
  const { isMobile } = useSidebar();
  if (!isMobile) return null;
  return (
    <div className="flex h-12 shrink-0 items-center border-b border-kumo-line px-3">
      <Sidebar.Trigger aria-label="メニューを開く" />
    </div>
  );
}

function MobileSidebarClose() {
  const { isMobile } = useSidebar();
  if (!isMobile) return null;
  return <Sidebar.Close aria-label="閉じる" />;
}

function SidebarPaneButtons(props: {
  pane: Pane;
  colorPreference: ColorPreference;
  developerMode: boolean;
  onPane: (pane: Pane) => void;
  onColorPreference: () => void;
  onDeveloperMode: () => void;
}) {
  const closeDrawer = useCloseMobileDrawer();
  function openPane(next: Pane) {
    props.onPane(next);
    closeDrawer();
  }
  return (
    <>
      <Button
        size="sm"
        shape="square"
        variant={props.pane === "kanban" ? "secondary" : "ghost"}
        type="button"
        aria-label="カンバン"
        aria-pressed={props.pane === "kanban"}
        onClick={() => openPane("kanban")}
      >
        <KanbanIcon size={16} aria-hidden />
      </Button>
      <Button
        size="sm"
        shape="square"
        variant={props.pane === "ability" ? "secondary" : "ghost"}
        type="button"
        aria-label="能力"
        aria-pressed={props.pane === "ability"}
        onClick={() => openPane("ability")}
      >
        <SparkleIcon size={16} aria-hidden />
      </Button>
      <Button
        size="sm"
        shape="square"
        variant={props.developerMode ? "secondary" : "ghost"}
        type="button"
        aria-label={`開発者モード: ${props.developerMode ? "ON" : "OFF"}。切替`}
        aria-pressed={props.developerMode}
        onClick={props.onDeveloperMode}
      >
        <CodeIcon size={16} aria-hidden />
      </Button>
      <Button
        size="sm"
        shape="square"
        variant="ghost"
        type="button"
        aria-label={`表示: ${colorPreferenceLabel(props.colorPreference)}。次へ切替`}
        onClick={props.onColorPreference}
      >
        {props.colorPreference === "dark" ? (
          <MoonIcon size={16} aria-hidden />
        ) : props.colorPreference === "system" ? (
          <DesktopIcon size={16} aria-hidden />
        ) : (
          <SunIcon size={16} aria-hidden />
        )}
      </Button>
    </>
  );
}

function SidebarThreadList(props: {
  pane: Pane;
  threads: ProductView["threads"];
  activeThreadId: string | null;
  runningThreadIds: readonly string[];
  editingThreadId: string | null;
  onEditingThreadId: (id: string | null) => void;
  onPane: (pane: Pane) => void;
  onView: (view: ProductView) => void;
  onLeaveGallery: () => void;
  onShowThreadProgress: (threadId: string | null) => void;
  onNewThread: () => void;
}) {
  const closeDrawer = useCloseMobileDrawer();
  const running = new Set(props.runningThreadIds);
  function openChat() {
    props.onLeaveGallery();
    props.onPane("chat");
    closeDrawer();
  }
  return (
    <Sidebar.Group>
      <div className="mt-4 mb-2 flex items-center gap-1 px-1 [[data-sidebar=group]:first-child_&]:mt-2">
        <span className="min-w-0 flex-1 truncate px-2 text-sm font-medium text-kumo-subtle">会話</span>
        <Button
          size="sm"
          shape="square"
          variant="ghost"
          type="button"
          aria-label="新しい会話"
          onClick={() => {
            props.onEditingThreadId(null);
            openChat();
            props.onShowThreadProgress(null);
            void postJson("/api/thread", {}).then((next) => {
              props.onView(next);
              props.onNewThread();
            });
          }}
        >
          <PlusIcon size={14} aria-hidden />
        </Button>
      </div>
      <Sidebar.Menu>
        {props.threads.map((thread) => (
          <Sidebar.MenuItem key={thread.id}>
            {props.editingThreadId === thread.id ? (
              <ThreadTitleEditor
                title={thread.title}
                onCancel={() => props.onEditingThreadId(null)}
                onSave={(title) => {
                  props.onEditingThreadId(null);
                  void postJson("/api/thread", { id: thread.id, title }).then(props.onView);
                }}
              />
            ) : (
              <Sidebar.MenuButton
                active={props.pane === "chat" && thread.id === props.activeThreadId}
                onClick={() => {
                  openChat();
                  if (thread.id !== props.activeThreadId) {
                    props.onShowThreadProgress(thread.id);
                    void postJson("/api/thread", { id: thread.id }).then(props.onView);
                  }
                }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  props.onEditingThreadId(thread.id);
                }}
              >
                <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                {running.has(thread.id) ? null : thread.awaiting === "handoff" ? (
                  <BrowserIcon
                    size={14}
                    className="shrink-0 text-kumo-warning"
                    role="img"
                    aria-label="ブラウザ使用中"
                  />
                ) : thread.awaiting === "approval" ? (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-kumo-warning"
                    role="img"
                    aria-label="承認待ち"
                  />
                ) : null}
                {running.has(thread.id) ? (
                  <Loader
                    size="sm"
                    className="shrink-0 text-kumo-subtle"
                    aria-label="応答中"
                  />
                ) : null}
              </Sidebar.MenuButton>
            )}
          </Sidebar.MenuItem>
        ))}
      </Sidebar.Menu>
    </Sidebar.Group>
  );
}

function ThreadTitleEditor(props: {
  title: string;
  onSave: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(props.title);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  function commit() {
    const next = value.trim();
    if (!next || next === props.title) {
      props.onCancel();
      return;
    }
    props.onSave(next);
  }

  return (
    <div
      className="relative flex min-h-8.5 w-full min-w-0 items-center rounded-lg bg-(--sidebar-active-bg) px-3 py-0"
      data-sidebar="menu-button"
    >
      <input
        ref={inputRef}
        aria-label="会話名"
        className="w-full min-w-0 border-0 bg-transparent p-0 text-sm font-medium text-kumo-default outline-none"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            props.onCancel();
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

function ChatPane(props: {
  lines: ThreadLine[];
  cards: CardView[];
  live: string;
  status: string;
  tools: ToolProgress[];
  speaking: boolean;
  notice: string | null;
  tokenCapReached: boolean;
  tokenCapMessage: string;
  planPending: boolean;
  pendingPlan: string | null;
  pendingDelete: ProductView["pendingDelete"];
  pendingMcp: ProductView["pendingMcp"];
  pendingAgentWrite: ProductView["pendingAgentWrite"];
  pendingBrowserHandoff: ProductView["pendingBrowserHandoff"];
  draft: string;
  error: string;
  attach: SpeakAttachPayload | null;
  speakQueue: QueuedSpeak | null;
  last: ProductView["last"];
  focusNonce: number;
  model: string;
  modelChoices: ChatModelChoice[];
  onModel: (model: string) => void;
  onDraft: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onStop: () => void;
  onSendNow: () => void;
  onClearQueue: () => void;
  onDismissNotice: () => void;
  onPlan: (decision: "approve" | "reject") => void;
  onPick: (text: string) => void;
  onFormCommit: (values: Record<string, FormValue>, speakSummary?: string) => void;
  onBrowserHandoffComplete: (outcome?: "done" | "failed") => void;
  onBrowserHandoffType: (text: string) => Promise<void>;
  onAttach: (file: File | null) => void | Promise<void>;
  onClearAttach: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [
    props.lines.length,
    props.live,
    props.status,
    props.tools.length,
    props.notice,
    props.planPending,
    props.pendingBrowserHandoff,
    props.last?.operation?.reason
  ]);

  const livePreview = [...props.tools].reverse().find((row) => row.preview)?.preview;
  const liveViewUrl = [...props.tools]
    .reverse()
    .find((row) => typeof row.liveViewUrl === "string" && row.liveViewUrl.startsWith("http"))
    ?.liveViewUrl;
  const cardTitles: Record<string, string> = {};
  for (const card of props.cards) {
    if (card.id && card.title) cardTitles[card.id] = card.title;
  }

  useEffect(() => {
    if (props.focusNonce === 0) return;
    const id = requestAnimationFrame(() => {
      composerRef.current?.querySelector("textarea")?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [props.focusNonce]);

  const showFail = Boolean(props.last?.operation && !props.last.operation.ok);
  const failLabel = showFail
    ? [
        props.last!.operation.reason,
        props.last!.unconfirmed.length > 0
          ? `未確認 ${props.last!.unconfirmed.map((item) => item.value).join(", ")}`
          : null
      ].filter(Boolean).join(" / ")
    : "";

  return (
    <FileDropZone
      enabled={!props.speaking && !props.tokenCapReached}
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 overflow-hidden p-5"
      onFiles={(files) => {
        const file = files[0] ?? null;
        void props.onAttach(file);
      }}
    >
      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-1 pb-1">
        {props.lines.length === 0 && !props.live && !props.speaking ? (
          <Empty title="まだ発話はない。" />
        ) : null}
        {props.lines.map((line, index) => (
          <Message
            key={index}
            line={line}
            handoff={
              index === props.lines.length - 1 &&
              line.role === "assistant" &&
              props.pendingBrowserHandoff &&
              !props.speaking
                ? props.pendingBrowserHandoff
                : null
            }
            onHandoffComplete={props.onBrowserHandoffComplete}
            onHandoffType={props.onBrowserHandoffType}
            onPick={
              index === props.lines.length - 1 && line.role === "assistant" && !props.speaking
                ? props.onPick
                : undefined
            }
            onFormCommit={
              index === props.lines.length - 1 && line.role === "assistant" && !props.speaking
                ? props.onFormCommit
                : undefined
            }
            threadLineKey={`line-${index}`}
            cardTitles={cardTitles}
            speaking={props.speaking}
            modelLabel={
              line.role === "assistant" && line.model && line.model !== props.model
                ? modelLabelOf(props.modelChoices, line.model)
                : undefined
            }
          />
        ))}
        {props.live || (props.speaking && props.tools.length > 0) || props.status ? (
          <Message
            line={{ role: "assistant", text: props.live || props.status || "…" }}
            busy
            statusPending={!props.live && Boolean(props.status)}
            liveTools={props.tools}
            livePreview={livePreview}
            liveViewUrl={liveViewUrl}
          />
        ) : null}
        {props.pendingBrowserHandoff && props.lines.length === 0 ? (
          <BrowserHandoffBar
            handoff={props.pendingBrowserHandoff}
            disabled={props.speaking}
            onComplete={props.onBrowserHandoffComplete}
            onType={props.onBrowserHandoffType}
          />
        ) : null}
        {showFail ? (
          <div className="flex flex-wrap items-center gap-2 p-0.5">
            <Text variant="secondary" size="sm" as="p" role="status">{failLabel}</Text>
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        {props.planPending ? (
          <PlanHitlBanner
            pendingPlan={props.pendingPlan}
            pendingDelete={props.pendingDelete}
            pendingMcp={props.pendingMcp}
            pendingAgentWrite={props.pendingAgentWrite}
            onPlan={props.onPlan}
          />
        ) : null}
        {props.notice ? (
          <DismissibleNoticeBanner title={props.notice} onDismiss={props.onDismissNotice} />
        ) : null}
        {props.tokenCapReached ? (
          <Text variant="secondary" size="sm" as="p" role="status">
            {props.tokenCapMessage || "本日の利用上限に達しました。明日また利用できます。"}
          </Text>
        ) : null}
        {props.speakQueue ? (
          <LayerCard className="flex flex-wrap items-center gap-2 rounded-lg p-3">
            <div className="min-w-0 flex-1 truncate">
              <Text size="sm" as="span">
                {props.speakQueue.attach
                  ? `${props.speakQueue.text || "（添付のみ）"} · ${props.speakQueue.attach.name}`
                  : props.speakQueue.text}
              </Text>
            </div>
            <Button size="sm" variant="primary" type="button" onClick={props.onSendNow}>今すぐ送信</Button>
            <Button size="sm" variant="ghost" type="button" onClick={props.onClearQueue}>取り消す</Button>
          </LayerCard>
        ) : null}
        {props.attach ? (
          <div className="flex flex-wrap items-center gap-2 px-1">
            <Text size="sm" as="span">{props.attach.name}</Text>
            {props.attach.media.startsWith("image/") &&
            props.modelChoices.find((choice) => choice.id === props.model)?.images === false ? (
              <Text variant="secondary" size="sm" as="span" role="status">
                Vision 非対応
              </Text>
            ) : null}
            <Button size="sm" variant="ghost" type="button" onClick={props.onClearAttach}>外す</Button>
          </div>
        ) : null}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
          className="hidden"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0] ?? null;
            void props.onAttach(file);
            event.currentTarget.value = "";
          }}
        />
        <div
          ref={composerRef}
          className="flex items-center gap-1.5 rounded-[1.75rem] bg-kumo-tint p-1.5 ring ring-kumo-line"
        >
          <Button
            size="sm"
            shape="circle"
            variant="secondary"
            type="button"
            aria-label="資料を添付"
            className="self-center"
            onClick={() => fileRef.current?.click()}
          >
            <PlusIcon size={16} aria-hidden />
          </Button>
          <InputArea
            aria-label="メッセージ"
            className="min-w-0 flex-1 border-0 bg-transparent py-1.5 shadow-none ring-0 focus-visible:ring-0"
            placeholder="メッセージ"
            value={props.draft}
            maxLength={20000}
            autoResize
            minRows={1}
            maxRows={6}
            onValueChange={props.onDraft}
            onKeyDown={props.onKeyDown}
          />
          <ModelPicker
            model={props.model}
            choices={props.modelChoices}
            disabled={props.speaking}
            onModel={props.onModel}
          />
          {props.speaking ? (
            <Button
              size="sm"
              shape="circle"
              variant="primary"
              type="button"
              aria-label="停止"
              className="self-center"
              onClick={props.onStop}
            >
              <StopIcon size={16} weight="fill" aria-hidden />
            </Button>
          ) : (
            <Button
              size="sm"
              shape="circle"
              variant="primary"
              type="button"
              aria-label="送る"
              className="self-center"
              disabled={!props.draft.trim() && !props.attach && !props.speakQueue}
              onClick={props.onSend}
            >
              <PaperPlaneTiltIcon size={16} aria-hidden />
            </Button>
          )}
        </div>
        {props.error ? <Text variant="secondary" size="sm" as="p" role="alert">{props.error}</Text> : null}
      </div>
    </FileDropZone>
  );
}

const KANBAN_LANES: Record<
  (typeof CARD_STATES)[number],
  { icon: Icon; fill: string; accent: string }
> = {
  未着手: { icon: CircleDashedIcon, fill: "bg-kumo-tint", accent: "text-kumo-subtle" },
  実行中: { icon: PlayIcon, fill: "bg-kumo-info-tint", accent: "text-kumo-info" },
  確認待ち: { icon: HourglassMediumIcon, fill: "bg-kumo-warning-tint", accent: "text-kumo-warning" },
  完了: { icon: SealCheckIcon, fill: "bg-kumo-success-tint", accent: "text-kumo-success" }
};

function KanbanPane(props: {
  cards: CardView[];
  notice: string | null;
  onChange: (view: ProductView) => void;
}) {
  const [addingState, setAddingState] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  function moveCard(id: string, state: string) {
    void postJson("/api/move", { id, state }).then(props.onChange);
  }

  function discardDraft() {
    setAddingState(null);
    setTitle("");
  }

  function commitDraft(state: string) {
    const next = title.trim();
    if (!next) {
      discardDraft();
      return;
    }
    setAddingState(null);
    setTitle("");
    void postJson("/api/card", { title: next, state }).then(props.onChange);
  }

  function acceptLaneDrag(event: DragEvent<HTMLElement>, state: string) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dropTarget !== state) setDropTarget(state);
  }

  function dropOnLane(event: DragEvent<HTMLElement>, state: string) {
    event.preventDefault();
    setDropTarget(null);
    const id = event.dataTransfer.getData(CARD_DRAG) || event.dataTransfer.getData("text/plain");
    setDraggingId(null);
    if (!id) return;
    const card = props.cards.find((item) => item.id === id);
    if (!card || card.state === state) return;
    moveCard(id, state);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-5">
      <Text variant="heading" as="h1">カンバン</Text>
      {props.notice ? (
        <DismissibleNoticeBanner
          title={props.notice}
          onDismiss={() => {
            void postJson("/api/notice", { scope: "notice" }).then(props.onChange);
          }}
        />
      ) : null}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-4">
        {CARD_STATES.map((state) => {
          const lane = KANBAN_LANES[state];
          const LaneIcon = lane.icon;
          const dragging = draggingId ? props.cards.find((card) => card.id === draggingId) : undefined;
          const showDropSlot = dropTarget === state && dragging !== undefined && dragging.state !== state;
          return (
            <div
              key={state}
              className={`flex h-full min-h-0 flex-col overflow-hidden rounded-lg p-3 shadow-xs ring ${lane.fill} ${
                showDropSlot ? "ring-2 ring-white/70" : "ring-kumo-line"
              }`}
              onDragEnter={(event) => acceptLaneDrag(event, state)}
              onDragOver={(event) => acceptLaneDrag(event, state)}
              onDragLeave={(event) => {
                const next = event.relatedTarget;
                if (next instanceof Node && event.currentTarget.contains(next)) return;
                setDropTarget((current) => (current === state ? null : current));
              }}
              onDrop={(event) => dropOnLane(event, state)}
            >
              <div className="flex shrink-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <LaneIcon size={16} className={`shrink-0 ${lane.accent}`} aria-hidden />
                  <Text variant="secondary" size="sm" as="h2">{state}</Text>
                </div>
                <Button
                  size="sm"
                  shape="square"
                  variant="ghost"
                  type="button"
                  aria-label={`${state}に追加`}
                  onClick={() => {
                    setAddingState(state);
                    setTitle("");
                  }}
                >
                  <PlusIcon size={14} aria-hidden />
                </Button>
              </div>
              <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-0.5">
                {showDropSlot ? (
                  <div
                    className="pointer-events-none h-14 shrink-0 rounded-lg bg-white/25 ring-1 ring-white/80 dark:bg-white/10 dark:ring-white/55"
                    aria-hidden
                  />
                ) : null}
                {addingState === state ? (
                  <KanbanTitleDraft
                    title={title}
                    onTitle={setTitle}
                    onCommit={() => commitDraft(state)}
                    onDiscard={discardDraft}
                  />
                ) : null}
                {props.cards.filter((card) => card.state === state).map((card) => (
                  <article
                    key={card.id}
                    className={`flex gap-2 rounded-lg bg-kumo-base p-3 ring ring-kumo-line ${
                      draggingId === card.id ? "opacity-50" : ""
                    }`}
                    draggable
                    onDragStart={(event: DragEvent<HTMLElement>) => {
                      if ((event.target as HTMLElement).closest("[data-no-drag]")) {
                        event.preventDefault();
                        return;
                      }
                      event.dataTransfer.setData(CARD_DRAG, card.id);
                      event.dataTransfer.setData("text/plain", card.id);
                      event.dataTransfer.effectAllowed = "move";
                      setDraggingId(card.id);
                    }}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDropTarget(null);
                    }}
                  >
                    <span
                      className="mt-0.5 shrink-0 cursor-grab text-kumo-subtle active:cursor-grabbing"
                      aria-hidden
                    >
                      <DotsSixVerticalIcon size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <Text as="p">{card.title}</Text>
                      <div className="mt-2 flex flex-wrap items-center gap-2" data-no-drag>
                        <Select
                          className="min-w-0 flex-1"
                          size="sm"
                          aria-label={`${card.title}の状態`}
                          value={card.state}
                          onValueChange={(value) => {
                            if (value) moveCard(card.id, value);
                          }}
                        >
                          {CARD_STATES.map((next) => (
                            <Select.Option key={next} value={next}>{next}</Select.Option>
                          ))}
                        </Select>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KanbanTitleDraft(props: {
  title: string;
  onTitle: (value: string) => void;
  onCommit: () => void;
  onDiscard: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const discardRef = useRef(false);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
  }, []);

  return (
    <article className="flex gap-2 rounded-lg bg-kumo-base p-3 ring ring-kumo-interact">
      <span className="mt-0.5 shrink-0 text-kumo-subtle" aria-hidden>
        <DotsSixVerticalIcon size={16} />
      </span>
      <input
        ref={inputRef}
        aria-label="件名"
        className="w-full min-w-0 border-0 bg-transparent p-0 text-sm text-kumo-default outline-none"
        value={props.title}
        onChange={(event) => props.onTitle(event.target.value)}
        onBlur={() => {
          if (discardRef.current) return;
          if (!props.title.trim()) props.onDiscard();
          else props.onCommit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            discardRef.current = true;
            props.onDiscard();
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
    </article>
  );
}

type AbilityKind = "memory" | "skill" | "automation" | "mcp" | "document";
type AbilityFilter = "all" | AbilityKind;
type CreateKind = "note" | "memo" | "skill" | "workflow";

type AbilityItem = {
  id: string;
  kind: AbilityKind;
  title: string;
  detail: string;
  icon?: Icon;
  /** Phosphor の代わりにサービスロゴなどを置く。 */
  mark?: ReactNode;
  action?: ReactNode;
  /** MCP 内の塊。接続済みと追加候補を分けて見せる。 */
  group?: "connected" | "available";
  /** 状態バッジ。null / 未設定は表示なし。active | need_action | error。 */
  status?: AbilityStatus;
  /** 行クリック（アクション以外）。 */
  onActivate?: () => void;
  /** 行内の一過性フィードバック（接続テストなど）。時間経過で消える。 */
  feedback?: {
    text: string;
    tone: "pending" | "ok" | "error";
  };
};

const ABILITY_FILTERS: { id: AbilityFilter; label: string }[] = [
  { id: "all", label: "すべて" },
  { id: "memory", label: "記憶" },
  { id: "skill", label: "スキル" },
  { id: "automation", label: "自動化" },
  { id: "mcp", label: "MCP" },
  { id: "document", label: "書類" }
];

function AbilityPane(props: {
  skills: SkillView[];
  workflows: WorkflowView[];
  posts: string[];
  ran: string[];
  notes: NoteView[];
  memos: MemoView[];
  jobs: string[];
  mcpServers: ProductView["mcpServers"];
  mcpCatalog: ProductView["mcpCatalog"];
  mcpHostAllow: string[];
  cliAllow: string[];
  documentsEnabled: boolean;
  capabilityGaps: NonNullable<ProductView["capabilityGaps"]>;
  notice: string | null;
  developerMode: boolean;
  onChange: (view: ProductView) => void;
}) {
  const [filter, setFilter] = useState<AbilityFilter>("all");
  const [documents, setDocuments] = useState<DocumentView[]>([]);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const documentInput = useRef<HTMLInputElement>(null);
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [editingSkill, setEditingSkill] = useState<SkillView | null>(null);
  const [mcpConnect, setMcpConnect] = useState<ProductView["mcpCatalog"][number] | null>(null);
  /** カタログ外の自由登録（URL 手入力）。「追加」メニューとは別導線。 */
  const [mcpUrlForm, setMcpUrlForm] = useState(false);
  const [clockDate, setClockDate] = useState("2026-10-15");
  const [clockHour, setClockHour] = useState("9");
  const [clockMinute, setClockMinute] = useState("0");
  const [probingId, setProbingId] = useState<string | null>(null);
  const [configureId, setConfigureId] = useState<string | null>(null);

  const documentsEnabled = props.documentsEnabled;
  useEffect(() => {
    if (!documentsEnabled) return;
    let alive = true;
    listDocuments()
      .then((rows) => {
        if (alive) setDocuments(rows);
      })
      .catch(() => {
        if (alive) setDocumentError("書類の一覧を読めなかった");
      });
    return () => {
      alive = false;
    };
  }, [documentsEnabled]);

  async function addDocuments(files: FileList | null) {
    if (!files || files.length === 0) return;
    setDocumentError(null);
    for (const file of Array.from(files)) {
      const uploaded = await uploadDocument(file);
      if (!uploaded.ok) {
        setDocumentError(documentUploadError(file.name, uploaded.reason));
        break;
      }
    }
    setDocuments(await listDocuments());
  }

  function openCreate(kind: CreateKind) {
    setMcpConnect(null);
    setMcpUrlForm(false);
    setEditingSkill(null);
    setCreateKind(kind);
  }

  function openEditSkill(skill: SkillView) {
    setCreateKind(null);
    setMcpConnect(null);
    setMcpUrlForm(false);
    setEditingSkill(skill);
  }

  function openMcpUrlForm() {
    setCreateKind(null);
    setEditingSkill(null);
    setMcpConnect(null);
    setMcpUrlForm(true);
  }
  const connectedServers = props.mcpServers.filter(
    (server) => server.auth === "none" || server.hasSecret || server.needsReauth
  );

  // 接続テストの行内 notice は ✗ で消さず、数秒で自動消去。
  useEffect(() => {
    const timers: number[] = [];
    for (const server of props.mcpServers) {
      const probe = server.lastProbe;
      if (!probe) continue;
      const wait = Math.max(0, 4_000 - (Date.now() - probe.at));
      const id = server.id;
      timers.push(
        window.setTimeout(() => {
          void postJson("/api/notice", { scope: "ability", id }).then(props.onChange);
        }, wait)
      );
    }
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [props.mcpServers, props.onChange]);

  const registeredCatalog = new Set(
    connectedServers
      .filter((server) => !server.needsReauth)
      .map((server) => server.catalogId)
      .filter(Boolean)
  );
  const catalogAvailable = props.mcpCatalog.filter((entry) => !registeredCatalog.has(entry.id));

  function startMcpConnect(entry: ProductView["mcpCatalog"][number]) {
    setCreateKind(null);
    setEditingSkill(null);
    setMcpUrlForm(false);
    const prefer = entry.auth[0];
    if (prefer === "bearer" || (entry.auth.includes("bearer") && !entry.auth.includes("oauth"))) {
      setMcpConnect(entry);
      return;
    }
    if (entry.auth.includes("oauth")) {
      void startMcpOAuthConnect({ catalogId: entry.id }).then((result) => {
        if (typeof result.authorizeUrl === "string" && result.authorizeUrl) {
          window.location.assign(result.authorizeUrl);
          return;
        }
        // DCR 非対応で Bearer 可ならトークン入力へ（技術エラーを面に出さない）。
        if (result.reason === "registration_unsupported" && entry.auth.includes("bearer")) {
          setMcpConnect(entry);
          if ("mcpServers" in result) props.onChange(result as ProductView);
          return;
        }
        // Bearer も無い oauth-only は事前 client が要る。notice を載せて黙殺しない。
        if ("notice" in result || "mcpServers" in result || "reason" in result) {
          props.onChange(result as ProductView);
        }
      });
      return;
    }
    if (entry.auth.includes("none")) {
      void postJson("/api/mcp", {
        op: "upsert",
        catalogId: entry.id,
        auth: "none"
      }).then(props.onChange);
    }
  }

  const items: AbilityItem[] = [
    ...documents.map((doc) => ({
      id: `doc:${doc.docId}`,
      kind: "document" as const,
      title: doc.name,
      detail: `v${doc.version} · ${formatBytes(doc.bytes)}`,
      icon: FileTextIcon,
      action: <DocumentVersionsMenu doc={doc} />
    })),
    ...props.notes.map((note) => ({
      id: `note:${note.id}`,
      kind: "memory" as const,
      title: note.title || note.id,
      detail: note.value !== null ? `${note.id} · ${note.value}` : note.id,
      icon: NotebookIcon,
      action: (
        <Button
          size="sm"
          variant="ghost"
          type="button"
          onClick={() => void postJson("/api/delete", { kind: "note", id: note.id }).then(props.onChange)}
        >
          削除
        </Button>
      )
    })),
    ...props.memos.map((memo) => ({
      id: `memo:${memo.id}`,
      kind: "memory" as const,
      title: memo.body.slice(0, 40) || memo.id,
      detail: `${memo.id} · v${memo.version}`,
      icon: NoteIcon,
      action: (
        <Button
          size="sm"
          variant="ghost"
          type="button"
          onClick={() => void postJson("/api/delete", { kind: "thread_memo", id: memo.id }).then(props.onChange)}
        >
          削除
        </Button>
      )
    })),
    ...props.skills.map((skill) => ({
      id: `skill:${skill.name}`,
      kind: "skill" as const,
      title: skill.name,
      detail: skill.description,
      icon: SparkleIcon,
      action: (
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="secondary" type="button" onClick={() => openEditSkill(skill)}>
            編集
          </Button>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => void postJson("/api/delete", { kind: "skill", id: skill.name }).then(props.onChange)}
          >
            削除
          </Button>
        </div>
      )
    })),
    ...props.workflows.map((flow) => ({
      id: `flow:${flow.id}`,
      kind: "automation" as const,
      title: flow.name,
      detail: `${flow.enabled ? "有効" : "無効"} · ${flow.steps.join("+")}`,
      icon: FlowArrowIcon,
      action: (
        <div className="flex flex-wrap items-center gap-1">
          <Button
            size="sm"
            variant="secondary"
            type="button"
            onClick={() => void postJson("/api/enable", { id: flow.id, enabled: !flow.enabled }).then(props.onChange)}
          >
            {flow.enabled ? "止める" : "有効にする"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => void postJson("/api/delete", { kind: "workflow", id: flow.id }).then(props.onChange)}
          >
            削除
          </Button>
        </div>
      )
    })),
    ...props.jobs.map((name) => ({
      id: `job:${name}`,
      kind: "automation" as const,
      title: name,
      detail: props.ran.includes(name) ? "実行済み" : "未実行",
      icon: PlayIcon,
      action: (
        <Button size="sm" variant="secondary" type="button" onClick={() => void postJson("/api/job", { name }).then(props.onChange)}>
          起動
        </Button>
      )
    })),
    ...connectedServers.map((server) => {
      const catalog = server.catalogId
        ? props.mcpCatalog.find((entry) => entry.id === server.catalogId)
        : undefined;
      const markId = server.catalogId ?? server.id;
      const probing = probingId === server.id;
      const feedback = probing
        ? {
            text: "接続確認中…",
            tone: "pending" as const
          }
        : server.lastProbe
          ? {
              text: server.lastProbe.ok
                ? `接続 OK · ${server.lastProbe.detail}`
                : `接続失敗: ${server.lastProbe.detail}`,
              tone: (server.lastProbe.ok ? "ok" : "error") as "ok" | "error"
            }
          : undefined;
      return {
        id: `mcp:${server.id}`,
        kind: "mcp" as const,
        title: server.name,
        detail: "",
        mark: mcpServiceMark(markId),
        group: "connected" as const,
        status: mcpConnectionStatus(server),
        feedback,
        onActivate: () => setConfigureId(server.id),
        action: (
          <div
            className="flex flex-wrap items-center gap-1"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {server.needsReauth ? (
              <Button
                size="sm"
                variant="secondary"
                type="button"
                onClick={() => {
                  if (catalog) {
                    startMcpConnect(catalog);
                    return;
                  }
                  if (server.auth === "bearer") {
                    setMcpConnect({
                      id: server.catalogId ?? server.id,
                      name: server.name,
                      url: server.url,
                      auth: ["bearer"]
                    });
                    return;
                  }
                  void startMcpOAuthConnect({
                    catalogId: server.catalogId,
                    name: server.name,
                    url: server.url
                  }).then((result) => {
                    if (typeof result.authorizeUrl === "string" && result.authorizeUrl) {
                      window.location.assign(result.authorizeUrl);
                      return;
                    }
                    if ("mcpServers" in result) props.onChange(result as ProductView);
                  });
                }}
              >
                再接続
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              type="button"
              loading={probing}
              disabled={probingId !== null}
              aria-label={`${server.name}の接続をテスト`}
              onClick={() => {
                setProbingId(server.id);
                void postJson("/api/mcp", { op: "probe", id: server.id })
                  .then(props.onChange)
                  .finally(() => setProbingId(null));
              }}
            >
              テスト
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => void postJson("/api/mcp", { op: "remove", id: server.id }).then(props.onChange)}
            >
              切断
            </Button>
          </div>
        )
      };
    }),
    ...catalogAvailable.map((entry) => ({
      id: `catalog:${entry.id}`,
      kind: "mcp" as const,
      title: entry.name,
      detail: "",
      mark: mcpServiceMark(entry.id),
      group: "available" as const,
      action: (
        <Button
          size="sm"
          variant="secondary"
          type="button"
          onClick={() => startMcpConnect(entry)}
        >
          接続
        </Button>
      )
    })),
    ...(props.cliAllow.length > 0
      ? [{
          id: "cli-allow",
          kind: "automation" as const,
          title: "CLI 許可",
          detail: props.cliAllow.join(" · "),
          icon: PlayIcon
        }]
      : []),
    ...(props.developerMode
      ? [{
          id: "clock",
          kind: "automation" as const,
          title: "時計",
          detail: "テスト用の時刻送り（日本時間）",
          icon: ClockIcon,
          action: (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                void postJson("/api/clock", {
                  date: clockDate,
                  hour: Number(clockHour),
                  minute: Number(clockMinute)
                }).then(props.onChange);
              }}
            >
              <FormInput label="日付" type="date" size="sm" value={clockDate} onValueChange={setClockDate} required />
              <FormInput label="時" type="number" size="sm" min={0} max={23} value={clockHour} onValueChange={setClockHour} required />
              <FormInput label="分" type="number" size="sm" min={0} max={59} value={clockMinute} onValueChange={setClockMinute} required />
              <Button size="sm" variant="secondary" type="submit">進める</Button>
            </form>
          )
        }]
      : [])
  ];

  const visible = filter === "all" ? items : items.filter((item) => item.kind === filter);
  const sections = ABILITY_FILTERS.filter((chip) => chip.id !== "all").flatMap((chip) => {
    const rows = visible.filter((item) => item.kind === chip.id);
    return rows.length > 0 ? [{ id: chip.id, label: chip.label, rows }] : [];
  });

  // 接続テストは行内 feedback。上部 Banner は接続フロー等の abilityNotice だけ。
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 overflow-hidden p-5">
      {props.notice ? (
        <DismissibleNoticeBanner
          title={props.notice}
          onDismiss={() => {
            void postJson("/api/notice", { scope: "ability" }).then(props.onChange);
          }}
        />
      ) : null}
      <Tabs
        size="sm"
        variant="segmented"
        className="w-fit max-w-full self-start"
        value={filter}
        onValueChange={(value) => setFilter(value as AbilityFilter)}
        tabs={ABILITY_FILTERS.filter((chip) => chip.id !== "document" || documentsEnabled).map((chip) => ({
          value: chip.id,
          label: chip.label
        }))}
      />
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Text variant="heading" as="h1">
            能力 {visible.length}
          </Text>
        </div>
        {filter === "mcp" ? (
          <Button size="sm" variant="secondary" type="button" onClick={openMcpUrlForm}>
            URL で接続
          </Button>
        ) : filter === "document" ? (
          <Button size="sm" variant="secondary" type="button" onClick={() => documentInput.current?.click()}>
            <PlusIcon size={14} aria-hidden />
            追加
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenu.Trigger
              render={
                <Button size="sm" variant="secondary" type="button">
                  <PlusIcon size={14} aria-hidden />
                  追加
                </Button>
              }
            />
            <DropdownMenu.Content>
              <DropdownMenu.Item onClick={() => openCreate("note")}>ノート</DropdownMenu.Item>
              <DropdownMenu.Item onClick={() => openCreate("memo")}>メモ</DropdownMenu.Item>
              <DropdownMenu.Item onClick={() => openCreate("skill")}>スキル</DropdownMenu.Item>
              <DropdownMenu.Item onClick={() => openCreate("workflow")}>
                ワークフロー
              </DropdownMenu.Item>
              {documentsEnabled ? (
                <DropdownMenu.Item onClick={() => documentInput.current?.click()}>書類</DropdownMenu.Item>
              ) : null}
            </DropdownMenu.Content>
          </DropdownMenu>
        )}
        <input
          ref={documentInput}
          type="file"
          multiple
          className="hidden"
          aria-label="書類を追加"
          onChange={(event) => {
            const input = event.currentTarget;
            void addDocuments(input.files).finally(() => {
              input.value = "";
            });
          }}
        />
      </div>
      {documentError ? (
        <Text variant="error" size="sm" role="alert">
          {documentError}
        </Text>
      ) : null}
      {props.capabilityGaps.length > 0 ? (
        <div className="flex flex-col gap-1" role="status">
          {props.capabilityGaps.map((gap) => (
            <Text key={gap.id} variant="secondary" size="sm" as="p">
              {gap.label}: {gap.missing.join(", ")} が無い
            </Text>
          ))}
        </div>
      ) : null}
      <AbilityCreateDialog
        kind={createKind}
        jobs={props.jobs}
        onOpenChange={(open) => {
          if (!open) setCreateKind(null);
        }}
        onChange={(view) => {
          props.onChange(view);
          setCreateKind(null);
        }}
      />
      <AbilityEditSkillDialog
        skill={editingSkill}
        onOpenChange={(open) => {
          if (!open) setEditingSkill(null);
        }}
        onChange={(view) => {
          props.onChange(view);
          setEditingSkill(null);
        }}
      />
      <McpUrlConnectDialog
        open={mcpUrlForm}
        mcpHostAllow={props.mcpHostAllow}
        onOpenChange={setMcpUrlForm}
        onChange={(view) => {
          props.onChange(view);
          setMcpUrlForm(false);
        }}
      />
      <ConnectCatalogMcpDialog
        entry={mcpConnect}
        onOpenChange={(open) => {
          if (!open) setMcpConnect(null);
        }}
        onChange={(view) => {
          props.onChange(view);
          setMcpConnect(null);
        }}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-1">
        {sections.length === 0 ? (
          <Empty title="まだない。" />
        ) : (
          <div className="flex flex-col gap-6">
            {sections.map((section) => {
              const groups =
                section.id === "mcp"
                  ? ([
                      {
                        id: "connected",
                        label: "接続中",
                        rows: section.rows.filter((row) => row.group === "connected")
                      },
                      {
                        id: "catalog",
                        label: "カタログ",
                        rows: section.rows.filter((row) => row.group !== "connected")
                      }
                    ] as const).filter((group) => group.rows.length > 0)
                  : null;
              return (
                <section key={section.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <Text variant="secondary" size="sm" as="h2">
                      {section.label}
                    </Text>
                    {section.id === "mcp" && filter !== "mcp" && !mcpUrlForm && !mcpConnect ? (
                      <Button size="sm" variant="ghost" type="button" onClick={openMcpUrlForm}>
                        URL で接続
                      </Button>
                    ) : null}
                  </div>
                  {groups ? (
                    <div className="flex flex-col gap-4 border-t border-kumo-hairline pt-1">
                      {groups.map((group) => (
                        <div key={group.id} className="flex flex-col gap-1">
                          <Text variant="secondary" size="sm" as="h3">
                            {group.label}
                          </Text>
                          <ul className="divide-y divide-kumo-hairline border-t border-kumo-hairline">
                            {group.rows.map((item) => (
                              <AbilityRow key={item.id} item={item} />
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <ul className="divide-y divide-kumo-hairline border-t border-kumo-hairline">
                      {section.rows.map((item) => (
                        <AbilityRow key={item.id} item={item} />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
      <McpConfigureDialog
        server={
          configureId
            ? (props.mcpServers.find((server) => server.id === configureId) ?? null)
            : null
        }
        open={configureId !== null}
        reloading={configureId !== null && probingId === configureId}
        onOpenChange={(open) => {
          if (!open) setConfigureId(null);
        }}
        onReload={() => {
          if (!configureId) return;
          setProbingId(configureId);
          void postJson("/api/mcp", { op: "probe", id: configureId })
            .then(props.onChange)
            .finally(() => setProbingId(null));
        }}
        onDisconnect={() => {
          if (!configureId) return;
          const id = configureId;
          setConfigureId(null);
          void postJson("/api/mcp", { op: "remove", id }).then(props.onChange);
        }}
      />
    </div>
  );
}

function documentUploadError(name: string, reason: string): string {
  if (reason === "too_large") return `${name}: 20MB を超える書類は置けない`;
  if (reason === "invalid_name") return `${name}: この名前は使えない（先頭のドット・記号の一部は不可）`;
  return `${name}: 追加できなかった（${reason}）`;
}

/** 版の一覧。開いたときだけ取りに行く。古い版も残っているので、どれでも落とせる。 */
function DocumentVersionsMenu(props: { doc: DocumentView }) {
  const [versions, setVersions] = useState<DocumentView[] | null>(null);
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open && versions === null) {
          void listDocumentVersions(props.doc.docId).then(setVersions, () => setVersions([]));
        }
      }}
    >
      <DropdownMenu.Trigger
        render={
          <Button size="sm" variant="ghost" type="button" aria-label={`${props.doc.name} の版`}>
            v{props.doc.version}
            <CaretDownIcon size={12} aria-hidden />
          </Button>
        }
      />
      <DropdownMenu.Content>
        {(versions ?? [props.doc])
          .slice()
          .reverse()
          .map((version) => (
            <DropdownMenu.Item
              key={version.version}
              onClick={() => {
                window.location.href = documentHref(props.doc.docId, version.version);
              }}
            >
              <span className="flex w-full items-baseline justify-between gap-4">
                <span className="tabular-nums">v{version.version}</span>
                <span className="text-xs tabular-nums text-kumo-subtle">
                  {new Date(version.updatedAt).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" })}
                </span>
              </span>
            </DropdownMenu.Item>
          ))}
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}

function AbilityRow(props: { item: AbilityItem }) {
  const Glyph = props.item.icon;
  const hasMark = Boolean(props.item.mark);
  const status = props.item.status ?? null;
  const statusBadge = abilityStatusBadge(status);
  const feedbackTone =
    props.item.feedback?.tone === "ok"
      ? "text-kumo-success"
      : props.item.feedback?.tone === "error"
        ? "text-kumo-danger"
        : "text-kumo-info";
  const clickable = Boolean(props.item.onActivate);
  const markClass = hasMark
    ? "relative flex size-9 shrink-0 items-center justify-center rounded-lg bg-white ring ring-kumo-line"
    : "relative flex size-9 shrink-0 items-center justify-center rounded-lg bg-kumo-tint text-kumo-default ring ring-kumo-line";
  return (
    <li
      className={
        clickable
          ? "flex cursor-pointer items-center gap-3 rounded-md py-3 outline-none hover:bg-kumo-tint/60 focus-visible:ring-2 focus-visible:ring-kumo-brand"
          : "flex items-center gap-3 py-3"
      }
      {...(clickable
        ? {
            role: "button" as const,
            tabIndex: 0,
            onClick: () => props.item.onActivate?.(),
            onKeyDown: (event: KeyboardEvent<HTMLLIElement>) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                props.item.onActivate?.();
              }
            }
          }
        : {})}
    >
      <span className={markClass}>
        {props.item.mark ?? (Glyph ? <Glyph size={18} aria-hidden /> : null)}
        {statusBadge ? (
          <span
            className={
              statusBadge.variant === "success"
                ? "absolute -right-0.5 -top-0.5 z-10 size-2.5 rounded-full bg-kumo-success ring-2 ring-kumo-base"
                : statusBadge.variant === "warning"
                  ? "absolute -right-0.5 -top-0.5 z-10 size-2.5 rounded-full bg-kumo-warning ring-2 ring-kumo-base"
                  : "absolute -right-0.5 -top-0.5 z-10 size-2.5 rounded-full bg-kumo-danger ring-2 ring-kumo-base"
            }
            title={statusBadge.label}
            aria-label={statusBadge.label}
          />
        ) : null}
      </span>
      <div className="min-w-0 flex-1">
        <Text as="p">{props.item.title}</Text>
        {props.item.detail ? <Text variant="secondary" size="sm" as="p">{props.item.detail}</Text> : null}
        {props.item.feedback ? (
          <p className={`mt-1 text-sm ${feedbackTone}`}>{props.item.feedback.text}</p>
        ) : null}
      </div>
      {props.item.action ? <div className="shrink-0">{props.item.action}</div> : null}
    </li>
  );
}

const CREATE_KIND_TITLE: Record<CreateKind, string> = {
  note: "ノート",
  memo: "メモ",
  skill: "スキル",
  workflow: "ワークフロー"
};

/**
 * 能力の作成／接続フォーム用ダイアログ。
 * LayerDialog は dismiss=ghost＋Actions が左右両端で、本文との余白も固定が狭い。
 * 入力タスクは ImageGallery と同様に Kumo `Dialog` で組む（secondary fill・右寄せフッタ）。
 */
function AbilityFormDialog(props: {
  open: boolean;
  title: string;
  formId: string;
  submitLabel: string;
  submitDisabled?: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog
        size="lg"
        className="top-1/2 flex max-h-[85dvh] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 p-5 sm:top-1/2 sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <Dialog.Title className="m-0 text-base font-medium text-kumo-default">
            {props.title}
          </Dialog.Title>
          <Dialog.Close
            aria-label="閉じる"
            render={(closeProps) => (
              <Button
                {...closeProps}
                type="button"
                size="sm"
                variant="secondary"
                shape="square"
                aria-label="閉じる"
              >
                <XIcon size={16} aria-hidden />
              </Button>
            )}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-0.5">{props.children}</div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => props.onOpenChange(false)}
          >
            やめる
          </Button>
          <Button
            type="submit"
            form={props.formId}
            variant="primary"
            disabled={props.submitDisabled}
          >
            {props.submitLabel}
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  );
}

function AbilityCreateDialog(props: {
  kind: CreateKind | null;
  jobs: string[];
  onOpenChange: (open: boolean) => void;
  onChange: (view: ProductView) => void;
}) {
  const kind = props.kind;
  const formId = kind ? `ability-create-${kind}` : "ability-create";
  return (
    <AbilityFormDialog
      open={kind !== null}
      title={kind ? CREATE_KIND_TITLE[kind] : ""}
      formId={formId}
      submitLabel="保存"
      onOpenChange={props.onOpenChange}
    >
      {kind === "note" ? <CreateNoteForm formId={formId} onChange={props.onChange} /> : null}
      {kind === "memo" ? <CreateMemoForm formId={formId} onChange={props.onChange} /> : null}
      {kind === "skill" ? <CreateSkillForm formId={formId} onChange={props.onChange} /> : null}
      {kind === "workflow" ? (
        <CreateWorkflowForm formId={formId} jobs={props.jobs} onChange={props.onChange} />
      ) : null}
    </AbilityFormDialog>
  );
}

function McpUrlConnectDialog(props: {
  open: boolean;
  mcpHostAllow: string[];
  onOpenChange: (open: boolean) => void;
  onChange: (view: ProductView) => void;
}) {
  const formId = "mcp-url-connect";
  return (
    <AbilityFormDialog
      open={props.open}
      title="URL で接続"
      formId={formId}
      submitLabel="接続"
      onOpenChange={props.onOpenChange}
    >
      <CreateMcpForm
        formId={formId}
        mcpHostAllow={props.mcpHostAllow}
        onChange={props.onChange}
      />
    </AbilityFormDialog>
  );
}

function CreateNoteForm(props: { formId: string; onChange: (view: ProductView) => void }) {
  const [noteId, setNoteId] = useState("n1");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [value, setValue] = useState("");
  return (
    <form
      id={props.formId}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = value.trim() === "" ? undefined : Number(value);
        void postJson("/api/note", {
          id: noteId,
          title,
          body,
          ...(parsed !== undefined && Number.isFinite(parsed) ? { value: parsed } : {})
        }).then(props.onChange);
      }}
    >
      <FormInput label="ID" value={noteId} onValueChange={setNoteId} required />
      <FormInput label="件名" value={title} onValueChange={setTitle} required />
      <FormInputArea label="本文" value={body} onValueChange={setBody} rows={3} required />
      <FormInput label="数値" value={value} onValueChange={setValue} required={false} />
    </form>
  );
}

function CreateMemoForm(props: { formId: string; onChange: (view: ProductView) => void }) {
  const [memoId, setMemoId] = useState("m1");
  const [memoBody, setMemoBody] = useState("");
  return (
    <form
      id={props.formId}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void postJson("/api/memo", { id: memoId, body: memoBody }).then(props.onChange);
      }}
    >
      <FormInput label="ID" value={memoId} onValueChange={setMemoId} required />
      <FormInputArea label="本文" value={memoBody} onValueChange={setMemoBody} rows={3} required />
    </form>
  );
}

function CreateSkillForm(props: { formId: string; onChange: (view: ProductView) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [memo, setMemo] = useState(false);
  return (
    <form
      id={props.formId}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void postJson("/api/skill", {
          name,
          description,
          body,
          material: memo ? "memo" : "utterance"
        }).then(props.onChange);
      }}
    >
      <FormInput label="名称" value={name} onValueChange={setName} required />
      <FormInput label="利用場面" value={description} onValueChange={setDescription} required />
      <FormInputArea label="本文" value={body} onValueChange={setBody} rows={4} required />
      <Checkbox
        label="素材を貼ったメモにする"
        checked={memo}
        onCheckedChange={(value) => setMemo(value === true)}
      />
    </form>
  );
}

function AbilityEditSkillDialog(props: {
  skill: SkillView | null;
  onOpenChange: (open: boolean) => void;
  onChange: (view: ProductView) => void;
}) {
  const skill = props.skill;
  const formId = "ability-edit-skill";
  return (
    <AbilityFormDialog
      open={skill !== null}
      title={skill ? `スキル「${skill.name}」` : ""}
      formId={formId}
      submitLabel="保存"
      onOpenChange={props.onOpenChange}
    >
      {skill ? (
        <EditSkillForm formId={formId} skill={skill} onChange={props.onChange} />
      ) : null}
    </AbilityFormDialog>
  );
}

function EditSkillForm(props: {
  formId: string;
  skill: SkillView;
  onChange: (view: ProductView) => void;
}) {
  const [description, setDescription] = useState(props.skill.description);
  const [body, setBody] = useState(props.skill.body);
  useEffect(() => {
    setDescription(props.skill.description);
    setBody(props.skill.body);
  }, [props.skill.name, props.skill.description, props.skill.body]);
  return (
    <form
      id={props.formId}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void postJson("/api/skill", {
          name: props.skill.name,
          description,
          body,
          material: props.skill.material
        }).then(props.onChange);
      }}
    >
      <FormInput label="利用場面" value={description} onValueChange={setDescription} required />
      <FormInputArea label="本文" value={body} onValueChange={setBody} rows={8} required />
    </form>
  );
}

function ConnectCatalogMcpDialog(props: {
  entry: ProductView["mcpCatalog"][number] | null;
  onOpenChange: (open: boolean) => void;
  onChange: (view: ProductView) => void;
}) {
  const entry = props.entry;
  const [secret, setSecret] = useState("");
  useEffect(() => {
    setSecret("");
  }, [entry?.id]);
  const formId = "mcp-catalog-bearer";
  const hint: McpBearerHint = entry
    ? (entry.bearer ?? {
        label: `${entry.name} のトークン`,
        where: `${entry.name} の開発者設定で発行する認証トークン`,
        placeholder: "…"
      })
    : { label: "トークン", where: "", placeholder: "…" };
  return (
    <AbilityFormDialog
      open={entry !== null}
      title={entry?.name ?? ""}
      formId={formId}
      submitLabel="接続"
      submitDisabled={!secret.trim()}
      onOpenChange={props.onOpenChange}
    >
      {entry ? (
        <form
          id={formId}
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!secret.trim()) return;
            void postJson("/api/mcp", {
              op: "upsert",
              catalogId: entry.id,
              auth: "bearer",
              secret: secret.trim()
            }).then(props.onChange);
          }}
        >
          <McpBearerSecretField hint={hint} value={secret} onValueChange={setSecret} />
        </form>
      ) : null}
    </AbilityFormDialog>
  );
}

function McpBearerSecretField(props: {
  hint: McpBearerHint;
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <FormInput
        label={props.hint.label}
        type="password"
        value={props.value}
        onValueChange={props.onValueChange}
        placeholder={props.hint.placeholder ?? "…"}
        required
        autoComplete="off"
      />
      <Text variant="secondary" size="sm" as="p">
        {props.hint.createUrl ? (
          <>
            {props.hint.where} ·{" "}
            <Link href={props.hint.createUrl} target="_blank" rel="noreferrer">
              発行する
            </Link>
          </>
        ) : (
          props.hint.where
        )}
      </Text>
    </div>
  );
}

function CreateMcpForm(props: {
  formId: string;
  mcpHostAllow: string[];
  onChange: (view: ProductView) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("https://");
  const [auth, setAuth] = useState<"none" | "bearer">("none");
  const [secret, setSecret] = useState("");
  const [confirmUnknown, setConfirmUnknown] = useState(false);
  const hosts = props.mcpHostAllow;
  let hostHint = "";
  try {
    hostHint = new URL(url).hostname.toLowerCase();
  } catch {
    hostHint = "";
  }
  const known = !hostHint || hosts.some((entry) => hostHint === entry || hostHint.endsWith(`.${entry}`));
  const canConnect = auth === "none" || secret.trim().length > 0;
  return (
    <form
      id={props.formId}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!known && !confirmUnknown) return;
        if (!canConnect) return;
        void postJson("/api/mcp", {
          op: "upsert",
          name,
          url,
          auth,
          ...(auth === "bearer" ? { secret: secret.trim() } : {}),
          confirmUnknownHost: !known && confirmUnknown
        }).then(props.onChange);
      }}
    >
      <FormInput label="名称" value={name} onValueChange={setName} placeholder="例: docs" required />
      <FormInput
        label="エンドポイント"
        value={url}
        onValueChange={setUrl}
        placeholder="https://mcp.notion.com/mcp"
        inputMode="url"
        required
      />
      {!known && hostHint ? (
        <Checkbox
          label={`カタログ外ホスト ${hostHint} を許可して接続する`}
          checked={confirmUnknown}
          onCheckedChange={(value) => setConfirmUnknown(value === true)}
        />
      ) : null}
      <FormSelect
        label="認証"
        hideLabel={false}
        required
        value={auth}
        onValueChange={(value) => {
          if (value === "none" || value === "bearer") setAuth(value);
        }}
      >
        <FormSelect.Option value="none">なし</FormSelect.Option>
        <FormSelect.Option value="bearer">Bearer</FormSelect.Option>
      </FormSelect>
      {auth === "bearer" ? (
        <McpBearerSecretField hint={MCP_FREE_BEARER_HINT} value={secret} onValueChange={setSecret} />
      ) : null}
    </form>
  );
}

function CreateWorkflowForm(props: {
  formId: string;
  jobs: string[];
  onChange: (view: ProductView) => void;
}) {
  const [name, setName] = useState("");
  const [post, setPost] = useState("起きた");
  const [schedule, setSchedule] = useState("daily");
  const [hour, setHour] = useState("9");
  const [minute, setMinute] = useState("0");
  const [weekday, setWeekday] = useState("4");
  const [monthDate, setMonthDate] = useState("15");
  const [everyHours, setEveryHours] = useState("3");
  const [kind, setKind] = useState<"post" | "job">("post");
  const [job, setJob] = useState(props.jobs[0] ?? "demo.ping");
  return (
    <form
      id={props.formId}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void postJson("/api/workflow", {
          name,
          post,
          schedule,
          ...(schedule === "interval"
            ? { everyHours: Number(everyHours) }
            : {
                hour: Number(hour),
                minute: Number(minute),
                ...(schedule === "weekly" ? { weekday: Number(weekday) } : {}),
                ...(schedule === "monthly" ? { date: Number(monthDate) } : {})
              }),
          ...(kind === "job" ? { job } : {})
        }).then(props.onChange);
      }}
    >
      <FormInput label="名称" value={name} onValueChange={setName} required />
      <FormSelect
        label="段の種類"
        hideLabel={false}
        required
        value={kind}
        onValueChange={(value) => {
          if (value === "post" || value === "job") setKind(value);
        }}
      >
        <FormSelect.Option value="post">スレッド投稿</FormSelect.Option>
        <FormSelect.Option value="job">ジョブ起動</FormSelect.Option>
      </FormSelect>
      {kind === "post" ? (
        <FormInput label="スレッドへ出す文" value={post} onValueChange={setPost} required={false} />
      ) : (
        <FormSelect
          label="ジョブ"
          hideLabel={false}
          required
          value={job}
          onValueChange={(value) => {
            if (typeof value === "string") setJob(value);
          }}
        >
          {props.jobs.map((jobName) => (
            <FormSelect.Option key={jobName} value={jobName}>{jobName}</FormSelect.Option>
          ))}
        </FormSelect>
      )}
      <FormSelect
        label="周期"
        hideLabel={false}
        required
        value={schedule}
        onValueChange={(value) => {
          if (typeof value === "string") setSchedule(value);
        }}
      >
        <FormSelect.Option value="daily">毎日</FormSelect.Option>
        <FormSelect.Option value="weekly">毎週</FormSelect.Option>
        <FormSelect.Option value="monthly">毎月</FormSelect.Option>
        <FormSelect.Option value="interval">間隔（時間）</FormSelect.Option>
      </FormSelect>
      {schedule === "interval" ? (
        <FormInput label="間隔（時間）" type="number" min={1} value={everyHours} onValueChange={setEveryHours} required />
      ) : (
        <>
          {schedule === "weekly" ? (
            <FormSelect
              label="曜日"
              hideLabel={false}
              required
              value={weekday}
              onValueChange={(value) => {
                if (typeof value === "string") setWeekday(value);
              }}
            >
              <FormSelect.Option value="0">日</FormSelect.Option>
              <FormSelect.Option value="1">月</FormSelect.Option>
              <FormSelect.Option value="2">火</FormSelect.Option>
              <FormSelect.Option value="3">水</FormSelect.Option>
              <FormSelect.Option value="4">木</FormSelect.Option>
              <FormSelect.Option value="5">金</FormSelect.Option>
              <FormSelect.Option value="6">土</FormSelect.Option>
            </FormSelect>
          ) : null}
          {schedule === "monthly" ? (
            <FormInput label="日付" type="number" min={1} max={31} value={monthDate} onValueChange={setMonthDate} required />
          ) : null}
          <div className="flex flex-wrap gap-3">
            <FormInput label="時" type="number" min={0} max={23} value={hour} onValueChange={setHour} required />
            <FormInput label="分" type="number" min={0} max={59} value={minute} onValueChange={setMinute} required />
          </div>
        </>
      )}
    </form>
  );
}

function activityGlyph(row: ToolProgress): ReactNode {
  if (row.kind === "mcp" && hasMcpServiceMark(row.target)) {
    return mcpServiceMark(row.target, 14);
  }
  const map: Record<ActivityKind, Icon> = {
    memory: NotebookIcon,
    skill: SparkleIcon,
    automation: FlowArrowIcon,
    mcp: PlugsConnectedIcon,
    search: MagnifyingGlassIcon,
    browser: GlobeIcon,
    calc: CalculatorIcon,
    cli: TerminalWindowIcon,
    plan: ListChecksIcon,
    ui: DesktopIcon,
    other: CircleDashedIcon
  };
  const Glyph = map[row.kind] ?? CircleDashedIcon;
  return <Glyph size={14} aria-hidden />;
}

function activitySummary(rows: NonNullable<ToolProgress[] | ThreadLine["activities"]>): string {
  const fail = rows.filter((row) => row.status === "fail").length;
  return fail > 0 ? `${rows.length}件 · 失敗 ${fail}` : `${rows.length}件`;
}

function ActivityRows({ rows }: { rows: NonNullable<ToolProgress[] | ThreadLine["activities"]> }) {
  return (
    <ul className="flex flex-col gap-0.5" aria-live="polite">
      {rows.map((row) => {
        const running = row.status === "running";
        return (
          <li key={row.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center text-kumo-subtle">
                {activityGlyph(row as ToolProgress)}
              </span>
              <span
                className={
                  running ? "fudo-status-shimmer text-sm text-kumo-default" : "text-sm text-kumo-subtle"
                }
              >
                {row.label}
              </span>
              {row.status === "fail" ? (
                <Text variant="secondary" size="sm" as="span">
                  失敗
                </Text>
              ) : null}
            </div>
            {row.quote ? (
              <blockquote className="ml-7 border-l-2 border-kumo-line pl-2.5 text-xs leading-relaxed whitespace-pre-wrap break-words text-kumo-subtle">
                {row.quote}
              </blockquote>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function ActivityDisclosure({
  rows
}: {
  rows: NonNullable<ToolProgress[] | ThreadLine["activities"]>;
}) {
  const failCount = rows.filter((row) => row.status === "fail").length;
  const [open, setOpen] = useState(failCount > 0);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger
        render={<Button variant="ghost" size="sm" type="button" />}
        className="gap-1 px-1.5 text-kumo-subtle"
      >
        <CaretDownIcon
          size={12}
          aria-hidden
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
        {activitySummary(rows)}
      </Collapsible.Trigger>
      <Collapsible.Panel className="mt-0.5">
        <ActivityRows rows={rows} />
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

/** 実行中は展開。完了後は折りたたみ（失敗ありは既定で開く）。 */
function ActivityList({ rows }: { rows: ToolProgress[] | ThreadLine["activities"] }) {
  if (!rows || rows.length === 0) return null;
  if (rows.some((row) => row.status === "running")) return <ActivityRows rows={rows} />;
  return <ActivityDisclosure rows={rows} />;
}

/** 横に張る Controlled GenUI。吹き出し 85% 上限を外して列幅いっぱいにする。 */
function uiNeedsColumnWidth(ui: ThreadLine["ui"]): boolean {
  return (ui ?? []).some(
    (part) =>
      part.kind === "dashboard" ||
      part.kind === "chart" ||
      part.kind === "map_snip" ||
      part.kind === "place_list" ||
      part.kind === "compare_table" ||
      part.kind === "draft_preview"
  );
}

function Message({
  line,
  busy = false,
  statusPending = false,
  liveTools,
  livePreview,
  liveViewUrl,
  handoff = null,
  onHandoffComplete,
  onHandoffType,
  onPick,
  onFormCommit,
  threadLineKey,
  cardTitles,
  speaking = false,
  modelLabel
}: {
  line: ThreadLine;
  busy?: boolean;
  /** 「考えています」等の待機表示。ストリーミング本文には付けない。 */
  statusPending?: boolean;
  liveTools?: ToolProgress[];
  livePreview?: ToolProgress["preview"];
  liveViewUrl?: string;
  handoff?: ProductView["pendingBrowserHandoff"];
  onHandoffComplete?: (outcome?: "done" | "failed") => void;
  onHandoffType?: (text: string) => Promise<void>;
  onPick?: (text: string) => void;
  onFormCommit?: (values: Record<string, FormValue>, speakSummary?: string) => void;
  threadLineKey?: string;
  cardTitles?: Record<string, string>;
  speaking?: boolean;
  modelLabel?: string;
}) {
  const mine = line.role === "user";
  const activities = liveTools ?? line.activities;
  const historyPreview = !liveTools
    ? [...(line.activities ?? [])].reverse().find((row) => row.preview)?.preview
    : undefined;
  const preview = livePreview ?? historyPreview;
  const showLiveView =
    typeof liveViewUrl === "string" && liveViewUrl.startsWith("http");
  const wide = !mine && uiNeedsColumnWidth(line.ui);
  const handoffTask = handoff?.task?.trim() ?? "";
  const hideHandoffEcho =
    Boolean(handoff) && Boolean(line.text) && isHandoffTaskEcho(line.text, handoffTask);
  const showText = Boolean(line.text) && !hideHandoffEcho;
  const showBubble =
    (line.attachments && line.attachments.length > 0) ||
    showText ||
    (!mine && !statusPending && Boolean(line.ui?.length)) ||
    (!mine &&
      !statusPending &&
      !(line.ui && line.ui.length > 0) &&
      Boolean(
        activities?.some(
          (row) =>
            row.status === "running" || (row.status === "fail" && row.kind === "calc")
        )
      ));
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`flex flex-col gap-2 ${wide ? "w-full max-w-full" : "max-w-[85%]"}`}
        {...(busy ? { "aria-busy": true } : {})}
      >
        {!mine &&
        ((activities && activities.length > 0) ||
          preview ||
          showLiveView ||
          (handoff && onHandoffComplete && onHandoffType)) ? (
          <div className="flex flex-col gap-2 p-0.5">
            <ActivityList rows={activities} />
            {showLiveView ? (
              <iframe
                title="ブラウザ画面"
                src={liveViewUrl}
                sandbox="allow-scripts allow-same-origin"
                className="pointer-events-none h-56 w-full max-w-md rounded-lg ring ring-kumo-line"
              />
            ) : preview ? (
              <img
                src={`data:${preview.mime};base64,${preview.base64}`}
                alt=""
                className="max-h-56 w-full max-w-md rounded-lg object-contain ring ring-kumo-line"
              />
            ) : null}
            {handoff && onHandoffComplete && onHandoffType ? (
              <BrowserHandoffBar
                handoff={handoff}
                disabled={speaking}
                onComplete={onHandoffComplete}
                onType={onHandoffType}
              />
            ) : null}
          </div>
        ) : null}
        {showBubble ? (
        <div
          className={`rounded-2xl px-3.5 py-2.5 ${mine ? "bg-fudo-chat-mine" : "bg-transparent"}`}
        >
          {line.attachments && line.attachments.length > 0 ? (
            <Text variant="secondary" size="sm" as="p">
              {line.attachments.map((item) => item.name).join(", ")}
            </Text>
          ) : null}
          {showText ? (
            statusPending ? (
              <p className="fudo-status-shimmer m-0 text-sm text-kumo-default">{line.text}</p>
            ) : (
              <ChatMarkdown text={line.text} />
            )
          ) : null}
          {!mine && !statusPending
            ? renderUiParts(line.ui, {
                pickDisabled: speaking || !onPick,
                onPick: onPick
                  ? (item) => {
                      onPick(pickSelectionText(item));
                    }
                  : undefined,
                onPlace: onPick
                  ? (item) => {
                      onPick(placeSelectionText(item));
                    }
                  : undefined,
                onFormCommit,
                threadLineKey,
                cardTitles,
                onComparePick: onPick
                  ? (rowId) => {
                      const compare = line.ui?.find((p) => p.kind === "compare_table");
                      if (!compare || compare.kind !== "compare_table") return;
                      const row = compare.rows.find((r) => r.id === rowId);
                      const title = row?.cells.title;
                      if (typeof title !== "string" || !title) return;
                      onPick(
                        rowId.startsWith("https://")
                          ? `「${title}」を採用します。${rowId}`
                          : `「${title}」を採用します。`
                      );
                    }
                  : undefined
              })
            : null}
          {!mine &&
          !statusPending &&
          !(line.ui && line.ui.length > 0) &&
          activities?.some((row) => row.status === "running") ? (
            <UiSurfacePending label="面を準備しています" />
          ) : null}
          {!mine &&
          !statusPending &&
          !(line.ui && line.ui.length > 0) &&
          activities?.some((row) => row.status === "fail" && row.kind === "calc") ? (
            <UiSurfaceError message="計算の面を出せませんでした" />
          ) : null}
        </div>
        ) : null}
        {modelLabel ? (
          <div className="px-3.5">
            <Text variant="secondary" size="xs" as="p">{modelLabel}</Text>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function modelLabelOf(choices: ChatModelChoice[], id: string): string {
  return choices.find((choice) => choice.id === id)?.label ?? id;
}

const MODEL_GROUPS: { billing: ChatModelChoice["billing"]; label: string }[] = [
  { billing: "free_allocation", label: "無料枠" },
  { billing: "gateway", label: "クレジットか自分のキー" }
];

function ModelPicker(props: {
  model: string;
  choices: ChatModelChoice[];
  disabled: boolean;
  onModel: (model: string) => void;
}) {
  if (props.choices.length === 0) return null;
  return (
    <Select
      size="sm"
      aria-label="対話モデル"
      className="max-w-40 shrink-0 self-center"
      value={props.model}
      disabled={props.disabled}
      renderValue={(value: string) => modelLabelOf(props.choices, value)}
      onValueChange={(value) => {
        if (typeof value === "string" && value && value !== props.model) props.onModel(value);
      }}
    >
      {MODEL_GROUPS.map((group) => {
        const items = props.choices.filter((choice) => choice.billing === group.billing);
        if (items.length === 0) return null;
        return (
          <Select.Group key={group.billing}>
            <Select.GroupLabel>{group.label}</Select.GroupLabel>
            {items.map((choice) => (
              <Select.Option key={choice.id} value={choice.id}>
                <span className="flex items-center gap-2">
                  {choice.label}
                  {choice.images ? <Badge variant="neutral">Vision</Badge> : null}
                </span>
              </Select.Option>
            ))}
          </Select.Group>
        );
      })}
    </Select>
  );
}
