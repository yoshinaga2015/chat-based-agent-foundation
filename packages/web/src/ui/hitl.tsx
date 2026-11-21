import { Button, Input, Text, Tooltip } from "@cloudflare/kumo";
import { InfoIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ProductView } from "../types";

/**
 * HITL 面（デスク状態）。`ThreadLine.ui` の UiPart とは別系統だが、
 * GenUI カタログの同族（確認して実行／ブラウザ引き継ぎ）。
 * 破壊操作を GenUI ボタンで短絡しない。
 */

export type HitlKind = "plan" | "browser_handoff";

export const HITL_CATALOG: {
  kind: HitlKind;
  job: string;
  note: string;
}[] = [
  {
    kind: "plan",
    job: "確認して実行する",
    note: "pendingPlan / pendingDelete / pendingMcp / pendingAgentWrite。縦積み HITL。スレッド単位。承認は /api/plan（threadId）。外部エージェントは書き戻す前に差分を出す。"
  },
  {
    kind: "browser_handoff",
    job: "確認して実行する（画面操作）",
    note: "pendingBrowserHandoff。縦積み HITL。task 先行・期限・完了／やめる。永続は引き継ぎを出したスレッド。"
  }
];

export function PlanHitlBanner(props: {
  pendingPlan: string | null;
  pendingDelete: ProductView["pendingDelete"];
  pendingMcp: ProductView["pendingMcp"];
  pendingAgentWrite?: ProductView["pendingAgentWrite"];
  onPlan: (decision: "approve" | "reject") => void;
}): ReactNode {
  const agent = props.pendingAgentWrite;
  if (agent && !props.pendingDelete && !props.pendingMcp) {
    return <AgentWriteHitl agent={agent} onPlan={props.onPlan} />;
  }
  const title = props.pendingDelete
    ? "削除の承認待ち"
    : props.pendingMcp
      ? "MCP 設定の承認待ち"
      : "実行計画の承認待ち";
  const body = props.pendingPlan?.trim() || "本文なし";
  // 長文を Kumo Banner description＋横並び Action に載せない（handoff と同系の縦積み）。
  return (
    <div className="flex flex-col gap-2 p-0.5">
      <div
        className="flex w-full min-w-0 flex-col gap-2 rounded-lg bg-kumo-warning-tint px-3 py-2.5 text-sm text-kumo-warning"
        role="status"
      >
        <p className="min-w-0 font-medium">{title}</p>
        <p className="min-w-0 leading-snug whitespace-pre-wrap break-words">{body}</p>
        <div className="flex min-w-0 flex-wrap gap-2">
          <Button size="sm" type="button" onClick={() => props.onPlan("approve")}>
            承認
          </Button>
          <Button size="sm" variant="secondary" type="button" onClick={() => props.onPlan("reject")}>
            却下
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * 書き戻す前の承認。見出しと範囲は引数から組み立てる（モデルの文を見出しにしない）。
 * 判断の材料は「どこに・何が変わるか」なので、変更ファイルと差分を出す。
 */
function AgentWriteHitl(props: {
  agent: NonNullable<ProductView["pendingAgentWrite"]>;
  onPlan: (decision: "approve" | "reject") => void;
}): ReactNode {
  const name = props.agent.agent === "claude-code" ? "Claude Code" : props.agent.agent;
  const workspace = props.agent.workspace;
  const target = workspace.kind === "repo" ? (workspace.ref ? `${workspace.repo}@${workspace.ref}` : workspace.repo) : null;
  return (
    <div className="flex flex-col gap-2 p-0.5">
      <section
        className="flex w-full min-w-0 flex-col gap-2 rounded-lg bg-kumo-warning-tint px-3 py-2.5 text-sm text-kumo-warning"
        role="status"
        aria-label={`${name} の変更の書き戻しの承認`}
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="min-w-0 font-medium">
            {name} の変更 {props.agent.changes.length}件
          </p>
          {target ? (
            <p className="min-w-0 truncate font-mono text-xs opacity-80" title={target}>
              {target}
            </p>
          ) : null}
        </div>
        <ul className="flex max-h-80 min-w-0 flex-col gap-1 overflow-y-auto p-0.5">
          {props.agent.changes.map((change) => (
            <AgentChangeRow key={change.path} change={change} />
          ))}
        </ul>
        <div className="flex min-w-0 flex-wrap gap-2">
          <Button size="sm" type="button" onClick={() => props.onPlan("approve")}>
            {workspace.kind === "repo" ? "PR を出す" : "新しい版で保存"}
          </Button>
          <Button size="sm" variant="secondary" type="button" onClick={() => props.onPlan("reject")}>
            捨てる
          </Button>
        </div>
      </section>
    </div>
  );
}

const CHANGE_MARK: Record<"added" | "modified" | "deleted", string> = {
  added: "追加",
  modified: "変更",
  deleted: "削除"
};

function AgentChangeRow(props: {
  change: NonNullable<ProductView["pendingAgentWrite"]>["changes"][number];
}): ReactNode {
  const { change } = props;
  const head = (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 text-xs opacity-80">{CHANGE_MARK[change.status]}</span>
      <span className="min-w-0 truncate font-mono text-xs" title={change.path}>
        {change.path}
      </span>
      {change.binary && change.bytes !== undefined ? (
        <span className="shrink-0 text-xs tabular-nums opacity-80">{formatBytes(change.bytes)}</span>
      ) : null}
    </span>
  );
  if (!change.diff) return <li className="min-w-0">{head}</li>;
  return (
    <li className="min-w-0">
      <details>
        <summary className="cursor-pointer list-none">{head}</summary>
        <pre className="mt-1 max-h-60 overflow-auto rounded bg-kumo-base p-2 font-mono text-[11px] leading-snug text-kumo-default">
          {change.diff.split("\n").map((line, index) => (
            <span key={index} className={`block ${diffLineClass(line)}`}>
              {line || " "}
            </span>
          ))}
        </pre>
      </details>
    </li>
  );
}

function diffLineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) {
    return "text-kumo-subtle";
  }
  if (line.startsWith("@@")) return "text-kumo-info";
  if (line.startsWith("+")) return "text-kumo-success";
  if (line.startsWith("-")) return "text-kumo-danger";
  return "";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function handoffTaskLabel(handoff: NonNullable<ProductView["pendingBrowserHandoff"]>): string {
  const task = handoff.task?.trim();
  if (task) return task;
  if (handoff.reason === "login") return "ログインを済ませ、目的の画面が見えたら「完了」または「やめる」を押してください。";
  if (handoff.reason === "captcha") return "認証や画像確認を済ませたら「完了」または「やめる」を押してください。";
  if (handoff.reason === "blocked") return "アクセス確認を通過したら「完了」または「やめる」を押してください。";
  return "画面で必要な操作を済ませたら「完了」または「やめる」を押してください。";
}

/** Banner が task を出すので、同じ文の吹き出しは出さない。 */
export function isHandoffTaskEcho(spoken: string, task: string): boolean {
  const a = spoken.replace(/\s+/g, "").trim();
  const b = task.replace(/\s+/g, "").trim();
  if (!a) return true;
  if (!b) return false;
  if (a === b) return true;
  if (b.length >= 16 && a.includes(b)) return true;
  if (a.length >= 16 && b.includes(a) && a.length >= b.length * 0.7) return true;
  return false;
}

function handoffRemainingLabel(remainingMs: number): string {
  const sec = Math.max(0, Math.ceil(remainingMs / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m <= 0) return `あと ${s}秒`;
  return s > 0 ? `あと ${m}分${s}秒` : `あと ${m}分`;
}

export function BrowserHandoffBar(props: {
  handoff: NonNullable<ProductView["pendingBrowserHandoff"]>;
  disabled?: boolean;
  onComplete: (outcome?: "done" | "failed") => void;
  onType: (text: string) => Promise<void>;
}): ReactNode {
  const [showType, setShowType] = useState(false);
  const [typed, setTyped] = useState("");
  const [sending, setSending] = useState(false);
  const [typeError, setTypeError] = useState("");
  const [typeHintOpen, setTypeHintOpen] = useState(false);
  const typeHintPinned = useRef(false);
  const typeFormRef = useRef<HTMLDivElement>(null);
  const expiresAt = props.handoff.expiresAt || props.handoff.createdAt + 10 * 60_000;
  const [now, setNow] = useState(() => Date.now());
  const remainingMs = Math.max(0, expiresAt - now);
  const expired = remainingMs <= 0;
  const task = handoffTaskLabel(props.handoff);
  // 共有面が無い旧データはカード自体を出さない（呼び出し側でも弾く）
  if (
    props.handoff.localOnly === true ||
    (typeof props.handoff.liveViewUrl === "string" &&
      props.handoff.liveViewUrl.startsWith("fudo-browser-run:"))
  ) {
    return null;
  }
  const canOpenLiveView =
    Boolean(props.handoff.liveViewUrl) && !props.handoff.liveViewUrl.startsWith("fudo-local:");

  useEffect(() => {
    if (expired) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [expired, expiresAt]);

  useEffect(() => {
    if (!showType) return;
    typeFormRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    typeFormRef.current?.querySelector("input")?.focus();
  }, [showType]);

  async function submitType() {
    if (!typed || props.disabled || sending || expired) return;
    setSending(true);
    setTypeError("");
    try {
      await props.onType(typed);
      setTyped("");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      setTypeError(
        reason === "no_handoff"
          ? "操作の引き継ぎが終了しています"
          : reason === "expired"
            ? "操作の有効期限が切れました"
            : reason === "stale"
              ? "ブラウザセッションが切れました。再度操作を引き継いでください。"
              : "入力に失敗しました"
      );
    } finally {
      setSending(false);
    }
  }

  // 長文 task を Banner description＋横並び Action に載せると折り返しとボタンはみ出しになる。
  // 縦積み: 見出し／期限 → task → 操作列（wrap）。本文は chat と同じ text-sm。
  return (
    <div className="flex flex-col gap-2 p-0.5">
      <div
        className="flex w-full min-w-0 flex-col gap-2 rounded-lg bg-kumo-warning-tint px-3 py-2.5 text-sm text-kumo-warning"
        role="status"
      >
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="min-w-0 font-medium">
            {expired ? "操作の有効期限が切れました" : "あなたが操作中"}
          </p>
          <p className="shrink-0 text-xs opacity-80">
            {expired ? "期限切れ" : handoffRemainingLabel(remainingMs)}
          </p>
        </div>
        <p className="min-w-0 leading-snug whitespace-pre-wrap break-words">{task}</p>
        <div className="flex min-w-0 flex-wrap gap-2">
          {canOpenLiveView ? (
            <Button
              size="sm"
              type="button"
              disabled={props.disabled || expired}
              onClick={() => {
                if (!props.handoff.liveViewUrl) return;
                window.open(props.handoff.liveViewUrl, "_blank", "noopener,noreferrer");
              }}
            >
              自分で操作
            </Button>
          ) : null}
          <Button
            size="sm"
            type="button"
            disabled={props.disabled || sending || expired}
            onClick={() => props.onComplete("done")}
          >
            完了
          </Button>
          <Button
            size="sm"
            variant="secondary"
            type="button"
            disabled={props.disabled || sending}
            onClick={() => props.onComplete("failed")}
          >
            やめる
          </Button>
        </div>
      </div>
      {!showType && !expired ? (
        <button
          type="button"
          className="self-start text-sm text-kumo-subtle disabled:text-kumo-inactive"
          disabled={props.disabled || sending}
          onClick={() => setShowType(true)}
        >
          文字入力できませんか？
        </button>
      ) : null}
      {showType ? (
        <div ref={typeFormRef} className="flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1">
            <Input
              size="sm"
              label={
                <>
                  ページへ入力
                  <Tooltip
                    open={typeHintOpen}
                    delay={200}
                    content="画面でフォーカスしている入力欄にテキストを送ります"
                    onOpenChange={(next) => {
                      if (!next && typeHintPinned.current) return;
                      if (!next) typeHintPinned.current = false;
                      setTypeHintOpen(next);
                    }}
                    render={
                      <Button
                        variant="ghost"
                        size="xs"
                        shape="square"
                        type="button"
                        aria-label="入力の説明"
                        onClick={(event) => {
                          event.preventDefault();
                          const next = !typeHintPinned.current;
                          typeHintPinned.current = next;
                          setTypeHintOpen(next);
                        }}
                      />
                    }
                  >
                    <InfoIcon className="size-4" />
                  </Tooltip>
                </>
              }
              value={typed}
              disabled={props.disabled || sending}
              onValueChange={setTyped}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                void submitType();
              }}
            />
          </div>
          <Button
            size="sm"
            variant="secondary"
            type="button"
            disabled={props.disabled || sending || !typed}
            onClick={() => {
              void submitType();
            }}
          >
            入力
          </Button>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            disabled={props.disabled || sending}
            onClick={() => {
              setShowType(false);
              setTyped("");
              setTypeError("");
              typeHintPinned.current = false;
              setTypeHintOpen(false);
            }}
          >
            やめる
          </Button>
        </div>
      ) : null}
      {typeError ? (
        <Text variant="secondary" size="sm" as="p" role="alert">
          {typeError}
        </Text>
      ) : null}
    </div>
  );
}
