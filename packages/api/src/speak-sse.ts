import type { SpeakRunStatus, SpeakStreamEvent } from "session";

export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export type SpeakLogReader = (
  runId: string,
  after: number
) => Promise<{ events: SpeakStreamEvent[]; status: SpeakRunStatus } | null>;

/** delivery log を SSE で tail。購読解除しても runner は止めない。 */
export function speakLogSseResponse(
  runId: string,
  read: SpeakLogReader,
  extras: Record<string, string> = {},
  pollMs = 40
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      let after = 0;
      let closed = false;
      const push = (event: SpeakStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(sseFrame(event.name, event.data)));
        } catch {
          closed = true;
        }
      };
      try {
        while (!closed) {
          const slice = await read(runId, after);
          if (!slice) {
            push({ name: "done", data: { interrupted: true, view: null, reason: "run_missing" } });
            break;
          }
          for (const event of slice.events) {
            push(event);
            after += 1;
          }
          if (slice.status !== "running") break;
          await new Promise((resolve) => setTimeout(resolve, pollMs));
        }
      } catch {
        // 購読側の切断など
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      // detach: runner は waitUntil / 背景 Promise で継続
    }
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      "x-accel-buffering": "no",
      "x-fudo-speak-run": runId,
      ...extras
    }
  });
}
