import type { ToolProgress } from "agent";

/** スレッド単位の in-flight 進捗。切替しても SSE はここに積む。 */
export type ThreadSpeakProgress = {
  tools: ToolProgress[];
  status: string;
  live: string;
  speaking: boolean;
};

export function emptySpeakProgress(): ThreadSpeakProgress {
  return { tools: [], status: "", live: "", speaking: false };
}

export function upsertToolProgress(tools: ToolProgress[], event: ToolProgress): ToolProgress[] {
  const index = tools.findIndex((row) => row.id === event.id);
  if (index < 0) return [...tools, event];
  const next = [...tools];
  next[index] = event;
  return next;
}

export function startSpeakProgress(status = "考えています…"): ThreadSpeakProgress {
  return { tools: [], status, live: "", speaking: true };
}

export function applyStatusProgress(prev: ThreadSpeakProgress, text: string): ThreadSpeakProgress {
  return { ...prev, status: text, speaking: true };
}

export function applyToolProgress(prev: ThreadSpeakProgress, event: ToolProgress): ThreadSpeakProgress {
  return { ...prev, tools: upsertToolProgress(prev.tools, event), speaking: true };
}

export function applyTokenProgress(prev: ThreadSpeakProgress, live: string): ThreadSpeakProgress {
  return { ...prev, live, status: "", speaking: true };
}

export function finishSpeakProgress(interrupted = false): ThreadSpeakProgress {
  return {
    tools: [],
    status: interrupted ? "前の返信は中断しました" : "",
    live: "",
    speaking: false
  };
}

/** 表示スレッドの進捗を取り出す。無ければ空。 */
export function visibleSpeakProgress(
  byThread: ReadonlyMap<string, ThreadSpeakProgress>,
  threadId: string | null
): ThreadSpeakProgress {
  if (!threadId) return emptySpeakProgress();
  return byThread.get(threadId) ?? emptySpeakProgress();
}

export function runningThreadIds(byThread: ReadonlyMap<string, ThreadSpeakProgress>): string[] {
  const ids: string[] = [];
  for (const [id, progress] of byThread) {
    if (progress.speaking) ids.push(id);
  }
  return ids;
}
