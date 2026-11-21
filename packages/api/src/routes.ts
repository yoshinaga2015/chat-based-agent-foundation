import {
  capabilityGapsFromEnv,
  domainRoute,
  parseSpeakAttachments,
  productBrowserSession,
  resolveDailyTokenCap,
  type DomainRoute
} from "agent";
import {
  addCard,
  advanceClock,
  draftSkill,
  browserHandoffThreadId,
  completeBrowserHandoff,
  typeBrowserHandoff,
  draftSpeak,
  enableFlow,
  interruptTurn,
  moveCard,
  proposePlan,
  completeMcpOAuth,
  createThread,
  deleteItem,
  mergeSpeakCommit,
  newSpeakRunId,
  probeMcpServer,
  dismissNotice,
  removeMcpServer,
  renameThread,
  setThreadModel,
  selectThread,
  resolvePlan,
  runDomainRoute,
  saveFlow,
  saveMcpServer,
  startJob,
  startMcpOAuth,
  UTTERANCE_CHARS,
  viewOf,
  writeMemo,
  writeNote,
  type Session
} from "session";
import { resolveServerBuildId, staleBuildHttpResponse } from "./build-id";
import { STUB_USER_ID } from "./constants";
import { applyAi, applyProcessEnv } from "./env";
import { corsHeadersFor, rejectBadOrigin } from "./security";
import { speakLogSseResponse, sseFrame } from "./speak-sse";
import {
  activeSpeakRun,
  appendSpeakEvent,
  beginTurn,
  commitSession,
  currentGeneration,
  finishSpeakRun,
  loadFullSession,
  readSpeakRun,
  startSpeakRun
} from "./store";
import { addTokens, loadTokensToday } from "./usage";
import { productBrowserSessionFromWorker } from "./browser-act-do";
import { sandboxCliRunner } from "./user-sandbox";
import { agentHostFor } from "./agent-host";
import { documentsRoute } from "./documents-route";

export { sseFrame };

export async function handleApi(
  request: Request,
  env: Env,
  gapMs = 40,
  ctx?: ExecutionContext
): Promise<Response> {
  applyProcessEnv(env);
  applyAi(env);
  const blocked = rejectBadOrigin(request, env);
  if (blocked) return blocked;

  const stale = staleBuildHttpResponse(request, resolveServerBuildId(env.FUDO_BUILD_ID));
  if (stale) return stale;

  const url = new URL(request.url);
  try {
    if (request.method === "GET" && url.pathname === "/api/session") {
      const session = await loadFullSession(env);
      return json(200, await productView(env, session));
    }
    if (request.method === "GET" && url.pathname === "/api/speak/stream") {
      const runId = url.searchParams.get("runId") ?? "";
      if (!runId) return json(400, { reason: "run_required" });
      return speakLogSseResponse(
        runId,
        (id, after) => readSpeakRun(env, id, after),
        corsHeadersFor(request, env),
        Math.max(20, gapMs)
      );
    }
    if (url.pathname === "/api/documents" || url.pathname.startsWith("/api/documents/")) {
      return documentsRoute(request, url, env, STUB_USER_ID);
    }
    const route = domainRoute(request.method, url.pathname);
    if (route) return apiDomainRoute(route, request, url, env);
    if (request.method === "GET" && url.pathname === "/api/mcp/oauth/callback") {
      const session = await loadFullSession(env);
      const finished = await completeMcpOAuth(session, {
        code: url.searchParams.get("code") ?? undefined,
        state: url.searchParams.get("state") ?? undefined,
        error: url.searchParams.get("error") ?? undefined,
        error_description: url.searchParams.get("error_description") ?? undefined
      });
      await commitSession(env, finished.session);
      const target = new URL("/?pane=ability", finished.redirectOrigin);
      return Response.redirect(target.toString(), 302);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeadersFor(request, env) });
    }
    if (request.method !== "POST") return new Response(null, { status: 404 });

    if (url.pathname === "/api/thread") {
      const body = await readJson(request);
      const id = text(body, "id");
      const title = text(body, "title");
      const model = text(body, "model");
      if (model) {
        const current = await loadFullSession(env);
        const next = setThreadModel(current, id, model);
        if (!next) return json(400, { reason: "model_unknown" });
        await commitSession(env, next);
        return json(200, await productView(env, next));
      }
      if (title) return mutate(env, (s) => renameThread(s, id, title));
      if (id) return mutate(env, (s) => selectThread(s, id));
      return mutate(env, (s) => createThread(s, Date.now()));
    }
    if (url.pathname === "/api/card") {
      const body = await readJson(request);
      const state = text(body, "state");
      return mutate(env, (s) => addCard(s, text(body, "title"), Date.now(), state || undefined));
    }
    if (url.pathname === "/api/move") {
      const body = await readJson(request);
      return mutate(env, (s) => moveCard(s, text(body, "id"), text(body, "state"), Date.now()));
    }
    if (url.pathname === "/api/skill") {
      const body = await readJson(request);
      return mutate(env, (s) => draftSkill(s, {
        name: text(body, "name"),
        description: text(body, "description"),
        body: text(body, "body"),
        material: text(body, "material") === "memo" ? "memo" : "utterance"
      }, Date.now()));
    }
    if (url.pathname === "/api/workflow") {
      const body = await readJson(request);
      const calc = text(body, "calc");
      const job = text(body, "job");
      return mutate(env, (s) => saveFlow(s, {
        name: text(body, "name"),
        id: text(body, "name"),
        schedule: scheduleOf(body),
        steps: job
          ? [{ type: "start_job", id: "job", name: job }]
          : calc
            ? [{ type: "run_calc", id: "calc", name: calc }]
            : [{ type: "thread_post", id: "post", text: text(body, "post") || "起きた" }]
      }, Date.now()));
    }
    if (url.pathname === "/api/enable") {
      const body = await readJson(request);
      return mutate(env, (s) => enableFlow(s, text(body, "id"), body["enabled"] === true));
    }
    if (url.pathname === "/api/delete") {
      const body = await readJson(request);
      return mutate(env, (s) => deleteItem(s, text(body, "kind"), text(body, "id"), Date.now()));
    }
    if (url.pathname === "/api/notice") {
      const body = await readJson(request);
      const scopeRaw = text(body, "scope");
      const scope =
        scopeRaw === "notice" || scopeRaw === "ability" || scopeRaw === "all"
          ? scopeRaw
          : "all";
      const id = text(body, "id") || undefined;
      return mutate(env, (s) => dismissNotice(s, scope, id));
    }
    if (url.pathname === "/api/mcp") {
      const body = await readJson(request);
      const op = text(body, "op") || "upsert";
      if (op === "remove") {
        return mutate(env, (s) => removeMcpServer(s, text(body, "id")));
      }
      if (op === "probe") {
        return mutate(env, (s) => probeMcpServer(s, text(body, "id")));
      }
      if (op === "oauth_start") {
        const origin = request.headers.get("Origin") || "http://127.0.0.1:4174";
        const redirectUri = `${origin}/api/mcp/oauth/callback`;
        const session = await loadFullSession(env);
        const started = await startMcpOAuth(
          session,
          {
            catalogId: text(body, "catalogId") || undefined,
            name: text(body, "name") || undefined,
            url: text(body, "url") || undefined
          },
          redirectUri,
          origin
        );
        await commitSession(env, started.session);
        if ("authorizeUrl" in started) {
          return json(200, { authorizeUrl: started.authorizeUrl });
        }
        // registration_unsupported は Bearer フォールバック用。400 にしない。
        if (started.error === "registration_unsupported") {
          return json(200, { reason: started.error, ...(await productView(env, started.session) as object) });
        }
        return json(400, { reason: started.error, ...(await productView(env, started.session) as object) });
      }
      const authRaw = text(body, "auth");
      const auth = authRaw === "bearer" || authRaw === "oauth" || authRaw === "none" ? authRaw : undefined;
      return mutate(env, (s) => saveMcpServer(s, {
        id: text(body, "id") || undefined,
        name: text(body, "name") || undefined,
        url: text(body, "url") || undefined,
        auth,
        secret: text(body, "secret") || undefined,
        catalogId: text(body, "catalogId") || undefined,
        confirmUnknownHost: body["confirmUnknownHost"] === true
      }));
    }
    if (url.pathname === "/api/clock") {
      const body = await readJson(request);
      return mutate(env, (s) => advanceClock(s, morningUtc(text(body, "date"), intOf(body, "hour", 9), intOf(body, "minute", 0))));
    }
    if (url.pathname === "/api/plan") {
      const body = await readJson(request);
      const decision = text(body, "decision");
      if (decision === "approve" || decision === "reject") {
        return mutate(env, (s) =>
          resolvePlan(s, decision, Date.now(), {
            threadId: text(body, "threadId") || undefined,
            agentHost: agentHostFor(env, STUB_USER_ID)
          })
        );
      }
      return mutate(env, async (s) => proposePlan(s, text(body, "text"), Date.now()));
    }
    if (url.pathname === "/api/note") {
      const body = await readJson(request);
      const valueRaw = body["value"];
      return mutate(env, (s) => writeNote(s, {
        id: text(body, "id"),
        title: text(body, "title"),
        body: text(body, "body"),
        value: typeof valueRaw === "number" && Number.isFinite(valueRaw) ? valueRaw : valueRaw === null ? null : undefined
      }, Date.now()));
    }
    if (url.pathname === "/api/memo") {
      const body = await readJson(request);
      return mutate(env, (s) => writeMemo(s, { id: text(body, "id"), body: text(body, "body") }, Date.now()));
    }
    if (url.pathname === "/api/job") {
      const body = await readJson(request);
      return mutate(env, (s) => startJob(s, text(body, "name") || "demo.ping", Date.now()));
    }
    if (url.pathname === "/api/interrupt") {
      await beginTurn(env);
      return mutate(env, (s) => interruptTurn(s, Date.now()));
    }
    if (url.pathname === "/api/speak") {
      return speak(request, env, gapMs, ctx);
    }
    if (url.pathname === "/api/browser-handoff") {
      return browserHandoff(request, env, gapMs, ctx);
    }
    if (url.pathname === "/api/migrate") {
      const body = await readJson(request);
      const { tryImportBlob } = await import("./store");
      await tryImportBlob(env, body as unknown as import("session").SessionBlob);
      const session = await loadFullSession(env);
      return json(200, await productView(env, session));
    }
    return new Response(null, { status: 404 });
  } catch (error) {
    console.error("api_error", error instanceof Error ? error.name : "unknown");
    return new Response(null, { status: 500 });
  }
}

async function apiDomainRoute(route: DomainRoute, request: Request, url: URL, env: Env): Promise<Response> {
  const session = await loadFullSession(env);
  const outcome = await runDomainRoute(
    route,
    {
      method: request.method,
      path: url.pathname,
      headers: (name) => request.headers.get(name),
      query: (name) => url.searchParams.get(name),
      json: () => readJson(request),
      bytes: async () => new Uint8Array(await request.arrayBuffer())
    },
    session,
    Date.now()
  );
  if (outcome.kind === "file") {
    return new Response(outcome.bytes, {
      headers: {
        "content-type": outcome.contentType,
        "content-disposition": `attachment; filename="${outcome.filename}"`,
        "x-content-type-options": "nosniff"
      }
    });
  }
  if (outcome.kind === "error") return json(outcome.status, { reason: outcome.reason });
  await commitSession(env, outcome.session);
  return json(200, { ...(await productView(env, outcome.session) as object), ...(outcome.extra ?? {}) });
}

async function mutate(env: Env, fn: (session: Session) => Session | Promise<Session>): Promise<Response> {
  const session = await loadFullSession(env);
  const next = await fn(session);
  await commitSession(env, next);
  return json(200, await productView(env, next));
}

async function productView(env: Env, session: Session, tokensToday?: number): Promise<unknown> {
  const tokenCap = resolveDailyTokenCap(process.env);
  const today = tokensToday ?? await loadTokensToday(env.DB, STUB_USER_ID);
  const activeSpeak = await activeSpeakRun(env);
  return {
    ...(viewOf(session, { tokensToday: today, tokenCap }) as object),
    activeSpeak,
    documentsEnabled: Boolean(env.DOCS),
    capabilityGaps: capabilityGapsFromEnv(
      {
        ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
        FUDO_CONTAINERS: env.FUDO_CONTAINERS,
        GITHUB_APP_ID: env.GITHUB_APP_ID,
        GITHUB_APP_PRIVATE_KEY: env.GITHUB_APP_PRIVATE_KEY,
        GITHUB_APP_INSTALLATION_ID: env.GITHUB_APP_INSTALLATION_ID,
        FUDO_AGENT_REPOS: env.FUDO_AGENT_REPOS
      },
      Boolean(env.DOCS)
    )
  };
}

async function speak(
  request: Request,
  env: Env,
  gapMs: number,
  ctx?: ExecutionContext
): Promise<Response> {
  const body = await readJson(request);
  const textValue = typeof body["text"] === "string" ? body["text"] : "";
  const parsed = parseSpeakAttachments(body["attachments"]);
  if (!parsed.ok) return json(400, { reason: parsed.reason });
  if (textValue.trim().length > UTTERANCE_CHARS) return json(400, { reason: "too_long" });

  const mine = await beginTurn(env);
  const committed = await loadFullSession(env);
  const tokenCap = resolveDailyTokenCap(process.env);
  const tokensToday = await loadTokensToday(env.DB, STUB_USER_ID);
  const runId = newSpeakRunId();
  const originThreadId = committed.activeThreadId;
  await startSpeakRun(env, { runId, threadId: originThreadId, generation: mine });

  const work = (async () => {
    const push = async (name: string, data: unknown) => {
      await appendSpeakEvent(env, runId, { name, data });
    };
    try {
      await push("run", { runId, threadId: originThreadId });
      await push("status", { text: "考えています…" });
      await wait(gapMs);
      if ((await currentGeneration(env)) !== mine) {
        await push("done", { interrupted: true, view: await productView(env, committed, tokensToday) });
        await finishSpeakRun(env, runId, "interrupted");
        return;
      }
      const draft = await draftSpeak(committed, textValue, Date.now(), undefined, parsed.attachments, {
        tokensToday,
        tokenCap
      }, {
        cliRunner: sandboxCliRunner(env, STUB_USER_ID),
        agentHost: agentHostFor(env, STUB_USER_ID),
        browserSession: productBrowserSessionFromWorker(env),
        onTool: (event) => {
          void push("tool", event);
          void push("status", { text: event.status === "running" ? event.label : "考えています…" });
        }
      });
      if (draft.rejected) {
        await push("done", {
          interrupted: true,
          view: await productView(env, committed, tokensToday),
          reason: draft.rejected
        });
        await finishSpeakRun(env, runId, "interrupted");
        return;
      }
      if ((await currentGeneration(env)) !== mine) {
        await push("done", { interrupted: true, view: await productView(env, committed, tokensToday) });
        await finishSpeakRun(env, runId, "interrupted");
        return;
      }
      for (const token of draft.tokens) {
        if ((await currentGeneration(env)) !== mine) {
          await push("done", { interrupted: true, view: await productView(env, committed, tokensToday) });
          await finishSpeakRun(env, runId, "interrupted");
          return;
        }
        await push("token", { text: token });
      }
      const latest = await loadFullSession(env);
      const pin = originThreadId ?? draft.next.activeThreadId;
      const next = pin ? mergeSpeakCommit(latest, draft.next, pin) : draft.next;
      await commitSession(env, next);
      const after = draft.tokensUsed > 0
        ? await addTokens(env.DB, STUB_USER_ID, draft.tokensUsed)
        : tokensToday;
      await push("done", { interrupted: false, view: await productView(env, next, after) });
      await finishSpeakRun(env, runId, "done");
    } catch {
      try {
        await push("done", { interrupted: true, view: await productView(env, committed, tokensToday) });
      } catch {
        // ignore
      }
      await finishSpeakRun(env, runId, "failed");
    }
  })();

  if (ctx) ctx.waitUntil(work);
  else void work;

  return speakLogSseResponse(
    runId,
    (id, after) => readSpeakRun(env, id, after),
    corsHeadersFor(request, env),
    Math.max(20, gapMs)
  );
}

async function browserHandoff(
  request: Request,
  env: Env,
  gapMs: number,
  ctx?: ExecutionContext
): Promise<Response> {
  const body = await readJson(request);
  const action = text(body, "action");
  if (action === "type") {
    const typed = typeof body["text"] === "string" ? body["text"] : "";
    const committed = await loadFullSession(env);
    const browser = productBrowserSessionFromWorker(env) ?? productBrowserSession(process.env);
    const result = await typeBrowserHandoff(committed, typed, browser);
    if (!result.ok) return json(400, { reason: result.reason });
    return json(200, { ok: true });
  }
  if (action !== "complete" && action !== "fail") return json(400, { reason: "invalid_action" });

  const note = typeof body["note"] === "string" ? body["note"] : undefined;
  const resolve =
    action === "fail"
      ? { outcome: "failed" as const, note }
      : { outcome: "done" as const };

  const mine = await beginTurn(env);
  const committed = await loadFullSession(env);
  const tokenCap = resolveDailyTokenCap(process.env);
  const tokensToday = await loadTokensToday(env.DB, STUB_USER_ID);
  const runId = newSpeakRunId();
  const originThreadId = browserHandoffThreadId(committed) ?? committed.activeThreadId;
  await startSpeakRun(env, { runId, threadId: originThreadId, generation: mine });

  const work = (async () => {
    const push = async (name: string, data: unknown) => {
      await appendSpeakEvent(env, runId, { name, data });
    };
    try {
      await push("run", { runId, threadId: originThreadId });
      await push("status", { text: "考えています…" });
      await wait(gapMs);
      if ((await currentGeneration(env)) !== mine) {
        await push("done", { interrupted: true, view: await productView(env, committed, tokensToday) });
        await finishSpeakRun(env, runId, "interrupted");
        return;
      }
      const draft = await completeBrowserHandoff(
        committed,
        Date.now(),
        undefined,
        { tokensToday, tokenCap },
        {
          cliRunner: sandboxCliRunner(env, STUB_USER_ID),
        agentHost: agentHostFor(env, STUB_USER_ID),
          browserSession: productBrowserSessionFromWorker(env),
          onTool: (event) => {
            void push("tool", event);
            void push("status", { text: event.status === "running" ? event.label : "考えています…" });
          }
        },
        resolve
      );
      if ((await currentGeneration(env)) !== mine) {
        await push("done", { interrupted: true, view: await productView(env, committed, tokensToday) });
        await finishSpeakRun(env, runId, "interrupted");
        return;
      }
      for (const token of draft.tokens) {
        if ((await currentGeneration(env)) !== mine) {
          await push("done", { interrupted: true, view: await productView(env, committed, tokensToday) });
          await finishSpeakRun(env, runId, "interrupted");
          return;
        }
        await push("token", { text: token });
      }
      const latest = await loadFullSession(env);
      const pin = originThreadId ?? draft.next.activeThreadId;
      const next = pin ? mergeSpeakCommit(latest, draft.next, pin) : draft.next;
      await commitSession(env, next);
      const after = draft.tokensUsed > 0
        ? await addTokens(env.DB, STUB_USER_ID, draft.tokensUsed)
        : tokensToday;
      await push("done", { interrupted: false, view: await productView(env, next, after) });
      await finishSpeakRun(env, runId, "done");
    } catch {
      try {
        await push("done", { interrupted: true, view: await productView(env, committed, tokensToday) });
      } catch {
        // ignore
      }
      await finishSpeakRun(env, runId, "failed");
    }
  })();

  if (ctx) ctx.waitUntil(work);
  else void work;

  return speakLogSseResponse(
    runId,
    (id, after) => readSpeakRun(env, id, after),
    corsHeadersFor(request, env),
    Math.max(20, gapMs)
  );
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
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

/** date + 任意の時分を日本時間の壁時計として UTC ms にする。既定は 9:00。 */
function morningUtc(date: string, hour = 9, minute = 0): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return Date.parse("2026-10-15T00:00:00Z");
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, minute, 0) - 9 * 60 * 60 * 1000;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
