/** Speak / handoff の detached run と delivery log。 */

export type SpeakStreamEvent = {
  name: string;
  data: unknown;
};

export type SpeakRunStatus = "running" | "done" | "interrupted" | "failed";

export type SpeakRunSnapshot = {
  runId: string;
  threadId: string | null;
  generation: number;
  status: SpeakRunStatus;
  events: SpeakStreamEvent[];
};

export type ActiveSpeak = {
  runId: string;
  threadId: string | null;
};

export type SpeakRunStore = {
  start(input: { runId: string; threadId: string | null; generation: number }): void;
  append(runId: string, event: SpeakStreamEvent): void;
  finish(runId: string, status: Exclude<SpeakRunStatus, "running">): void;
  read(runId: string, after: number): { events: SpeakStreamEvent[]; status: SpeakRunStatus } | null;
  active(): ActiveSpeak | null;
};

export function createSpeakRunMemory(): SpeakRunStore {
  const runs = new Map<string, SpeakRunSnapshot>();
  let activeId: string | null = null;

  return {
    start(input) {
      runs.set(input.runId, {
        runId: input.runId,
        threadId: input.threadId,
        generation: input.generation,
        status: "running",
        events: []
      });
      activeId = input.runId;
    },
    append(runId, event) {
      const run = runs.get(runId);
      if (!run || run.status !== "running") return;
      run.events.push(event);
    },
    finish(runId, status) {
      const run = runs.get(runId);
      if (!run) return;
      run.status = status;
      if (activeId === runId) activeId = null;
    },
    read(runId, after) {
      const run = runs.get(runId);
      if (!run) return null;
      return { events: run.events.slice(Math.max(0, after)), status: run.status };
    },
    active() {
      if (!activeId) return null;
      const run = runs.get(activeId);
      if (!run || run.status !== "running") return null;
      return { runId: run.runId, threadId: run.threadId };
    }
  };
}

export function newSpeakRunId(now = Date.now()): string {
  return `sr${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
