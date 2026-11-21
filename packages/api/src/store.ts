import {
  dialogueFromSession,
  mergeStores,
  type ActiveSpeak,
  type Session,
  type SessionBlob,
  type SpeakRunStatus,
  type SpeakStreamEvent
} from "session";
import { STUB_USER_ID } from "./constants";
import { importLedgerIfEmpty, loadLedger, saveLedger } from "./d1";

export function sessionStub(env: Env): DurableObjectStub {
  const id = env.SESSION.idFromName(STUB_USER_ID);
  return env.SESSION.get(id);
}

export async function loadFullSession(env: Env): Promise<Session> {
  const stub = sessionStub(env);
  const dialogue = (await stub.fetch("https://do/dialogue").then((r) => r.json())) as ReturnType<typeof dialogueFromSession>;
  const ledger = await loadLedger(env.DB, STUB_USER_ID);
  return mergeStores(dialogue, ledger);
}

export async function commitSession(env: Env, session: Session): Promise<void> {
  const stub = sessionStub(env);
  const dialogue = dialogueFromSession(session);
  await Promise.all([
    stub.fetch("https://do/dialogue", { method: "PUT", body: JSON.stringify(dialogue) }),
    saveLedger(env.DB, STUB_USER_ID, session)
  ]);
}

export async function beginTurn(env: Env): Promise<number> {
  const stub = sessionStub(env);
  const body = (await stub.fetch("https://do/begin", { method: "POST" }).then((r) => r.json())) as { generation: number };
  return body.generation;
}

export async function currentGeneration(env: Env): Promise<number> {
  const stub = sessionStub(env);
  const body = (await stub.fetch("https://do/generation").then((r) => r.json())) as { generation: number };
  return body.generation;
}

export async function tryImportBlob(env: Env, blob: SessionBlob): Promise<void> {
  const stub = sessionStub(env);
  await stub.fetch("https://do/import", { method: "POST", body: JSON.stringify(blob) });
  await importLedgerIfEmpty(env.DB, STUB_USER_ID, blob);
}

export async function startSpeakRun(
  env: Env,
  input: { runId: string; threadId: string | null; generation: number }
): Promise<void> {
  const stub = sessionStub(env);
  await stub.fetch("https://do/speak-run/start", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function appendSpeakEvent(env: Env, runId: string, event: SpeakStreamEvent): Promise<void> {
  const stub = sessionStub(env);
  await stub.fetch("https://do/speak-run/append", {
    method: "POST",
    body: JSON.stringify({ runId, event })
  });
}

export async function finishSpeakRun(
  env: Env,
  runId: string,
  status: Exclude<SpeakRunStatus, "running">
): Promise<void> {
  const stub = sessionStub(env);
  await stub.fetch("https://do/speak-run/finish", {
    method: "POST",
    body: JSON.stringify({ runId, status })
  });
}

export async function readSpeakRun(
  env: Env,
  runId: string,
  after: number
): Promise<{ events: SpeakStreamEvent[]; status: SpeakRunStatus } | null> {
  const stub = sessionStub(env);
  const body = (await stub
    .fetch(`https://do/speak-run/read?runId=${encodeURIComponent(runId)}&after=${after}`)
    .then((r) => r.json())) as {
    ok?: boolean;
    events?: SpeakStreamEvent[];
    status?: SpeakRunStatus;
  };
  if (!body.ok || !body.events || !body.status) return null;
  return { events: body.events, status: body.status };
}

export async function activeSpeakRun(env: Env): Promise<ActiveSpeak | null> {
  const stub = sessionStub(env);
  const body = (await stub.fetch("https://do/speak-run/active").then((r) => r.json())) as {
    active: ActiveSpeak | null;
  };
  return body.active ?? null;
}
