import "./domain";
import {
  capabilityGapsFromEnv,
  domainRoute,
  mcpClientIdMetadataDocument,
  parseSpeakAttachments,
  resolveDailyTokenCap,
  tokyoDay
} from "agent";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { BUILD_HEADER, STALE_BUILD_STATUS, isStaleBuild } from "./build-id";
import { readPersistedSession, writePersistedSession } from "./persist";
import {
  addCard,
  advanceClock,
  draftSkill,
  browserHandoffThreadId,
  completeBrowserHandoff,
  typeBrowserHandoff,
  draftSpeak,
  deleteItem,
  enableFlow,
  interruptTurn,
  completeMcpOAuth,
  removeMcpServer,
  probeMcpServer,
  dismissNotice,
  saveMcpServer,
  startMcpOAuth,
  moveCard,
  proposePlan,
  createSpeakRunMemory,
  createThread,
  mergeSpeakCommit,
  newSpeakRunId,
  renameThread,
  setThreadModel,
  resolvePlan,
  runDomainRoute,
  selectThread,
  saveFlow,
  startJob,
  UTTERANCE_CHARS,
  viewOf,
  writeMemo,
  writeNote,
  type Session
} from "./session";

export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function writeSpeakLogSse(
  response: ServerResponse,
  store: ReturnType<typeof createSpeakRunMemory>,
  runId: string,
  pollMs: number
): Promise<void> {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    "x-accel-buffering": "no",
    "x-fudo-speak-run": runId
  });
  let after = 0;
  let closed = false;
  response.on("close", () => {
    closed = true;
  });
  while (!closed) {
    const slice = store.read(runId, after);
    if (!slice) {
      response.write(sseFrame("done", { interrupted: true, view: null, reason: "run_missing" }));
      break;
    }
    for (const event of slice.events) {
      response.write(sseFrame(event.name, event.data));
      after += 1;
    }
    if (slice.status !== "running") break;
    await wait(pollMs);
  }
  if (!response.writableEnded) response.end();
}

function commit(session: Session): Session {
  writePersistedSession(session);
  return session;
}

/** ローカル製品サーバ用の日次メータ（プロセス内。製品 Worker は D1）。 */
const localUsage = new Map<string, number>();

function localTokensToday(nowMs = Date.now()): number {
  return localUsage.get(tokyoDay(nowMs)) ?? 0;
}

function localAddTokens(delta: number, nowMs = Date.now()): number {
  if (!Number.isFinite(delta) || delta <= 0) return localTokensToday(nowMs);
  const day = tokyoDay(nowMs);
  const next = (localUsage.get(day) ?? 0) + Math.floor(delta);
  localUsage.set(day, next);
  return next;
}

function localView(
  session: Session,
  tokensToday = localTokensToday(),
  speakRuns?: ReturnType<typeof createSpeakRunMemory>
): unknown {
  return {
    ...(viewOf(session, {
      tokensToday,
      tokenCap: resolveDailyTokenCap(process.env)
    }) as object),
    activeSpeak: speakRuns?.active() ?? null,
    capabilityGaps: capabilityGapsFromEnv(process.env, false)
  };
}

function serverBuildId(): string | null {
  const value = process.env.FUDO_BUILD_ID?.trim();
  return value || null;
}

function rejectStaleBuild(request: IncomingMessage, response: ServerResponse): boolean {
  if (request.method === "GET" || request.method === "HEAD") return false;
  const server = serverBuildId();
  if (!server) return false;
  const client = request.headers[BUILD_HEADER] ?? request.headers[BUILD_HEADER.toLowerCase()];
  const clientBuild = Array.isArray(client) ? client[0] ?? null : client ?? null;
  if (!isStaleBuild(server, clientBuild)) return false;
  response.writeHead(STALE_BUILD_STATUS, {
    "content-type": "application/json; charset=utf-8",
    [BUILD_HEADER]: server
  });
  response.end(JSON.stringify({ reason: "stale_build" }));
  return true;
}

export function createProductServer(page: Uint8Array, gapMs = 40): { server: ReturnType<typeof createServer>; session: () => Session } {
  let committed = readPersistedSession();
  let generation = 0;
  const speakRuns = createSpeakRunMemory();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(page);
        return;
      }
      if (rejectStaleBuild(request, response)) return;
      if (request.method === "GET" && url.pathname === "/oauth/mcp-client.json") {
        const originHeader = request.headers.origin;
        const publicOrigin = typeof originHeader === "string" && originHeader
          ? originHeader
          : "http://127.0.0.1:4174";
        const doc = mcpClientIdMetadataDocument(publicOrigin, [
          new URL("/api/mcp/oauth/callback", publicOrigin).toString()
        ]);
        json(response, 200, doc);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/session") {
        json(response, 200, localView(committed, localTokensToday(), speakRuns));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/speak/stream") {
        const runId = url.searchParams.get("runId") ?? "";
        if (!runId) {
          json(response, 400, { reason: "run_required" });
          return;
        }
        await writeSpeakLogSse(response, speakRuns, runId, Math.max(20, gapMs));
        return;
      }
      const route = domainRoute(request.method ?? "GET", url.pathname);
      if (route) {
        const outcome = await runDomainRoute(
          route,
          {
            method: request.method ?? "GET",
            path: url.pathname,
            headers: (name) => {
              const value = request.headers[name.toLowerCase()];
              return typeof value === "string" ? value : null;
            },
            query: (name) => url.searchParams.get(name),
            json: () => readJson(request),
            bytes: (limit) => readRaw(request, limit)
          },
          committed,
          Date.now()
        );
        if (outcome.kind === "file") {
          response.writeHead(200, {
            "content-type": outcome.contentType,
            "content-disposition": `attachment; filename="${outcome.filename}"`,
            "x-content-type-options": "nosniff"
          });
          response.end(outcome.bytes);
          return;
        }
        if (outcome.kind === "error") {
          json(response, outcome.status, { reason: outcome.reason });
          return;
        }
        committed = commit(outcome.session);
        json(response, 200, { ...localView(committed, localTokensToday(), speakRuns) as object, ...(outcome.extra ?? {}) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/mcp/oauth/callback") {
        const finished = await completeMcpOAuth(committed, {
          code: url.searchParams.get("code") ?? undefined,
          state: url.searchParams.get("state") ?? undefined,
          error: url.searchParams.get("error") ?? undefined,
          error_description: url.searchParams.get("error_description") ?? undefined
        });
        committed = commit(finished.session);
        const target = new URL("/?pane=ability", finished.redirectOrigin);
        response.writeHead(302, { location: target.toString() });
        response.end();
        return;
      }
      if (request.method !== "POST") {
        response.writeHead(404).end();
        return;
      }
      if (url.pathname === "/api/thread") {
        const body = await readJson(request);
        const id = typeof body["id"] === "string" ? body["id"] : "";
        const title = typeof body["title"] === "string" ? body["title"] : "";
        const model = typeof body["model"] === "string" ? body["model"] : "";
        if (model) {
          const next = setThreadModel(committed, id, model);
          if (!next) {
            json(response, 400, { reason: "model_unknown" });
            return;
          }
          committed = commit(next);
        } else if (title) committed = commit(renameThread(committed, id, title));
        else if (id) committed = commit(selectThread(committed, id));
        else committed = commit(createThread(committed, Date.now()));
        json(response, 200, localView(committed));
        return;
      }
      if (url.pathname === "/api/card") {
        const body = await readJson(request);
        const state = text(body, "state");
        committed = commit(addCard(committed, text(body, "title"), Date.now(), state || undefined));
        json(response, 200, localView(committed));
        return;
      }
      if (url.pathname === "/api/move") {
        const body = await readJson(request);
        committed = commit(moveCard(committed, text(body, "id"), text(body, "state"), Date.now()));
        json(response, 200, localView(committed));
        return;
      }
      if (url.pathname === "/api/skill") {
        const body = await readJson(request);
        committed = commit(draftSkill(committed, {
          name: text(body, "name"),
          description: text(body, "description"),
          body: text(body, "body"),
          material: text(body, "material") === "memo" ? "memo" : "utterance"
        }, Date.now()));
        json(response, 200, localView(committed));
        return;
      }
      if (url.pathname === "/api/workflow") {
        const body = await readJson(request);
        const calc = text(body, "calc");
        const job = text(body, "job");
        committed = commit(saveFlow(committed, {
          name: text(body, "name"),
          id: text(body, "name"),
          schedule: scheduleOf(body),
          steps: job
            ? [{ type: "start_job", id: "job", name: job }]
            : calc
              ? [{ type: "run_calc", id: "calc", name: calc }]
              : [{ type: "thread_post", id: "post", text: text(body, "post") || "起きた" }]
        }, Date.now()));
        json(response, 200, localView(committed));
        return;
      }
      if (url.pathname === "/api/enable") {
        const body = await readJson(request);
        committed = commit(enableFlow(committed, text(body, "id"), body["enabled"] === true));
        json(response, 200, localView(committed));
        return;
      }
      if (url.pathname === "/api/delete") {
        const body = await readJson(request);
        committed = commit(deleteItem(committed, text(body, "kind"), text(body, "id"), Date.now()));
        json(response, 200, localView(committed));
        return;
      }
      if (url.pathname === "/api/notice") {
        const body = await readJson(request);
        const scopeRaw = text(body, "scope");
        const scope =
          scopeRaw === "notice" || scopeRaw === "ability" || scopeRaw === "all"
            ? scopeRaw
            : "all";
        const id = text(body, "id") || undefined;
        committed = commit(dismissNotice(committed, scope, id));
        json(response, 200, localView(committed));
        return;
      }
      if (url.pathname === "/api/mcp") {
        const body = await readJson(request);
        const op = text(body, "op") || "upsert";
        if (op === "remove") {
          committed = commit(removeMcpServer(committed, text(body, "id")));
          json(response, 200, localView(committed));
          return;
        }
        if (op === "probe") {
          committed = commit(await probeMcpServer(committed, text(body, "id")));
          json(response, 200, localView(committed));
          return;
        }
        if (op === "oauth_start") {
          const originHeader = request.headers.origin;
          const origin = typeof originHeader === "string" && originHeader
            ? originHeader
            : "http://127.0.0.1:4174";
          const redirectUri = `${origin}/api/mcp/oauth/callback`;
          const started = await startMcpOAuth(
            committed,
            {
              catalogId: text(body, "catalogId") || undefined,
              name: text(body, "name") || undefined,
              url: text(body, "url") || undefined
            },
            redirectUri,
            origin
          );
          committed = commit(started.session);
          if ("authorizeUrl" in started) {
            json(response, 200, { authorizeUrl: started.authorizeUrl });
            return;
          }
          if (started.error === "registration_unsupported") {
            json(response, 200, { reason: started.error, ...(localView(committed) as object) });
            return;
          }
          json(response, 400, { reason: started.error, ...(localView(committed) as object) });
          return;
        }
        const authRaw = text(body, "auth");
        const auth = authRaw === "bearer" || authRaw === "oauth" || authRaw === "none" ? authRaw : undefined;
        committed = commit(await saveMcpServer(committed, {
          id: text(body, "id") || undefined,
          name: text(body, "name") || undefined,
          url: text(body, "url") || undefined,
          auth,
          secret: text(body, "secret") || undefined,
          catalogId: text(body, "catalogId") || undefined,
          confirmUnknownHost: body["confirmUnknownHost"] === true
        }));
        json(response, 200, localView(committed));
        return;
      }
      if (url.pathname === "/api/clock") {
        const body = await readJson(request);
        committed = commit(advanceClock(committed, morningUtc(text(body, "date"), intOf(body, "hour", 9), intOf(body, "minute", 0))));
        json(response, 200, localView(committed));
        return;
      }
      if (url.pathname === "/api/plan") {
        const body = await readJson(request);
        const decision = text(body, "decision");
        if (decision === "approve" || decision === "reject") {
          committed = commit(
            await resolvePlan(committed, decision, Date.now(), { threadId: text(body, "threadId") || undefined })
          );
        } else {
          committed = commit(await proposePlan(committed, text(body, "text"), Date.now()));
        }
        json(response, 200, localView(committed));
        return;
      }
      if (url.pathname === "/api/note") {
        const body = await readJson(request);
        const valueRaw = body["value"];
        committed = commit(writeNote(committed, {
          id: text(body, "id"),
          title: text(body, "title"),
          body: text(body, "body"),
          value: typeof valueRaw === "number" && Number.isFinite(valueRaw) ? valueRaw : valueRaw === null ? null : undefined
        }, Date.now()));
        json(response, 200, localView(committed));
        return;
      }
      if (url.pathname === "/api/memo") {
        const body = await readJson(request);
        committed = commit(writeMemo(committed, { id: text(body, "id"), body: text(body, "body") }, Date.now()));
        json(response, 200, localView(committed));
        return;
      }
      if (url.pathname === "/api/job") {
        const body = await readJson(request);
        committed = commit(startJob(committed, text(body, "name") || "demo.ping", Date.now()));
        json(response, 200, localView(committed));
        return;
      }
      if (url.pathname === "/api/interrupt") {
        committed = commit(interruptTurn(committed, Date.now()));
        generation += 1;
        json(response, 200, localView(committed, localTokensToday(), speakRuns));
        return;
      }
      if (url.pathname === "/api/speak") {
        const body = await readJson(request);
        const textValue = typeof body["text"] === "string" ? body["text"] : "";
        const parsed = parseSpeakAttachments(body["attachments"]);
        if (!parsed.ok) {
          json(response, 400, { reason: parsed.reason });
          return;
        }
        const mine = ++generation;
        if (textValue.trim().length > UTTERANCE_CHARS) {
          json(response, 400, { reason: "too_long" });
          return;
        }
        const tokenCap = resolveDailyTokenCap(process.env);
        const tokensToday = localTokensToday();
        const runId = newSpeakRunId();
        const originThreadId = committed.activeThreadId;
        const speakBase = committed;
        speakRuns.start({ runId, threadId: originThreadId, generation: mine });
        void (async () => {
          const push = (name: string, data: unknown) => speakRuns.append(runId, { name, data });
          try {
            push("run", { runId, threadId: originThreadId });
            push("status", { text: "考えています…" });
            await wait(gapMs);
            if (mine !== generation) {
              push("done", { interrupted: true, view: localView(committed, tokensToday, speakRuns) });
              speakRuns.finish(runId, "interrupted");
              return;
            }
            const draft = await draftSpeak(speakBase, textValue, Date.now(), undefined, parsed.attachments, {
              tokensToday,
              tokenCap
            }, {
              cliRunner: async (argv) => ({
                ok: true,
                stdout: `local-mock: ${argv.join(" ")}\n`,
                stderr: "",
                exitCode: 0
              }),
              onTool: (event) => {
                push("tool", event);
                push("status", { text: event.status === "running" ? event.label : "考えています…" });
              }
            });
            if (draft.rejected) {
              push("done", {
                interrupted: true,
                view: localView(committed, tokensToday, speakRuns),
                reason: draft.rejected
              });
              speakRuns.finish(runId, "interrupted");
              return;
            }
            if (mine !== generation) {
              push("done", { interrupted: true, view: localView(committed, tokensToday, speakRuns) });
              speakRuns.finish(runId, "interrupted");
              return;
            }
            for (const token of draft.tokens) {
              if (mine !== generation) {
                push("done", { interrupted: true, view: localView(committed, tokensToday, speakRuns) });
                speakRuns.finish(runId, "interrupted");
                return;
              }
              push("token", { text: token });
            }
            const pin = originThreadId ?? draft.next.activeThreadId;
            committed = commit(pin ? mergeSpeakCommit(committed, draft.next, pin) : draft.next);
            const after = draft.tokensUsed > 0 ? localAddTokens(draft.tokensUsed) : tokensToday;
            push("done", { interrupted: false, view: localView(committed, after, speakRuns) });
            speakRuns.finish(runId, "done");
          } catch {
            push("done", { interrupted: true, view: localView(committed, tokensToday, speakRuns) });
            speakRuns.finish(runId, "failed");
          }
        })();
        await writeSpeakLogSse(response, speakRuns, runId, Math.max(20, gapMs));
        return;
      }
      if (url.pathname === "/api/browser-handoff") {
        const body = await readJson(request);
        const action = text(body, "action");
        if (action === "type") {
          const typed = typeof body["text"] === "string" ? body["text"] : "";
          const result = await typeBrowserHandoff(committed, typed);
          if (!result.ok) {
            json(response, 400, { reason: result.reason });
            return;
          }
          json(response, 200, { ok: true });
          return;
        }
        if (action !== "complete" && action !== "fail") {
          json(response, 400, { reason: "invalid_action" });
          return;
        }
        const note = typeof body["note"] === "string" ? body["note"] : undefined;
        const resolve =
          action === "fail"
            ? { outcome: "failed" as const, note }
            : { outcome: "done" as const };
        const mine = ++generation;
        const tokenCap = resolveDailyTokenCap(process.env);
        const tokensToday = localTokensToday();
        const runId = newSpeakRunId();
        const originThreadId = browserHandoffThreadId(committed) ?? committed.activeThreadId;
        const handoffBase = committed;
        speakRuns.start({ runId, threadId: originThreadId, generation: mine });
        void (async () => {
          const push = (name: string, data: unknown) => speakRuns.append(runId, { name, data });
          try {
            push("run", { runId, threadId: originThreadId });
            push("status", { text: "考えています…" });
            await wait(gapMs);
            if (mine !== generation) {
              push("done", { interrupted: true, view: localView(committed, tokensToday, speakRuns) });
              speakRuns.finish(runId, "interrupted");
              return;
            }
            const draft = await completeBrowserHandoff(
              handoffBase,
              Date.now(),
              undefined,
              { tokensToday, tokenCap },
              {
                onTool: (event) => {
                  push("tool", event);
                  push("status", { text: event.status === "running" ? event.label : "考えています…" });
                }
              },
              resolve
            );
            if (mine !== generation) {
              push("done", { interrupted: true, view: localView(committed, tokensToday, speakRuns) });
              speakRuns.finish(runId, "interrupted");
              return;
            }
            for (const token of draft.tokens) {
              if (mine !== generation) {
                push("done", { interrupted: true, view: localView(committed, tokensToday, speakRuns) });
                speakRuns.finish(runId, "interrupted");
                return;
              }
              push("token", { text: token });
            }
            const pin = originThreadId ?? draft.next.activeThreadId;
            committed = commit(pin ? mergeSpeakCommit(committed, draft.next, pin) : draft.next);
            const after = draft.tokensUsed > 0 ? localAddTokens(draft.tokensUsed) : tokensToday;
            push("done", { interrupted: false, view: localView(committed, after, speakRuns) });
            speakRuns.finish(runId, "done");
          } catch {
            push("done", { interrupted: true, view: localView(committed, tokensToday, speakRuns) });
            speakRuns.finish(runId, "failed");
          }
        })();
        await writeSpeakLogSse(response, speakRuns, runId, Math.max(20, gapMs));
        return;
      }
      response.writeHead(404).end();
    } catch {
      if (!response.headersSent) response.writeHead(500).end();
    }
  });
  return { server, session: () => committed };
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readRaw(request);
  if (raw.byteLength === 0) return {};
  const parsed = JSON.parse(new TextDecoder().decode(raw)) as unknown;
  return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
}

function readRaw(request: IncomingMessage, maxBytes = Number.POSITIVE_INFINITY): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on("data", (chunk: Buffer) => {
      total += chunk.byteLength;
      chunks.push(chunk);
      if (total > maxBytes) {
        request.destroy();
        resolve(new Uint8Array(Buffer.concat(chunks)).slice(0, maxBytes + 1));
      }
    });
    request.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    request.on("error", reject);
  });
}

function text(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

function scheduleOf(body: Record<string, unknown>): unknown {
  const kind = text(body, "schedule") || "daily";
  if (kind === "interval") {
    return { kind: "interval", everyHours: intOf(body, "everyHours", 1) };
  }
  const hour = intOf(body, "hour", 9);
  const minute = intOf(body, "minute", 0);
  if (kind === "weekly") return { kind: "weekly", weekday: intOf(body, "weekday", 4), hour, minute };
  if (kind === "monthly") return { kind: "monthly", date: intOf(body, "date", 15), hour, minute };
  return { kind: "daily", hour, minute };
}

function intOf(body: Record<string, unknown>, key: string, fallback: number): number {
  const value = body[key];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function morningUtc(date: string, hour = 9, minute = 0): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return Date.parse("2026-10-15T00:00:00Z");
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, minute, 0) - 9 * 60 * 60 * 1000;
}
