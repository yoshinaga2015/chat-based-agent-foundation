// 閉じた段をコードが順に実行する。モデルは段を飛ばして台帳を書けない。
import { advanceSchedule, isDue, saveSchedule, type Schedule } from "./clock";
import { applyCardChange, type Board } from "./kanban";
import { commitWrites, type Ledger } from "./ledger";
import { TOKEN_CAP_MESSAGE } from "./limits";
import type { Registries } from "./registry";
import { webSearch, type SearchAdapter } from "./search";

export const STEP_TYPES = [
  "ledger_read",
  "ledger_write",
  "kanban_add",
  "kanban_update",
  "thread_post",
  "commentary",
  "web_search",
  "run_calc",
  "start_job",
  "send"
] as const;

export type StepType = (typeof STEP_TYPES)[number];

export interface FlowStep {
  id: string;
  type: StepType;
  onEmpty?: string;
  onMissing?: string;
  kind?: "note" | "thread_memo";
  recordId?: string;
  fields?: Readonly<Record<string, unknown>>;
  version?: number;
  title?: string;
  state?: string;
  due?: string | null;
  body?: string;
  refs?: readonly string[];
  text?: string;
  prompt?: string;
  query?: string;
  name?: string;
  input?: unknown;
  templateId?: string;
  preview?: string;
  button?: boolean;
}

export interface Workflow {
  id: string;
  name: string;
  enabled: boolean;
  schedule: Schedule | null;
  steps: readonly FlowStep[];
}

export interface FlowWorld {
  ledger: Ledger;
  board: Board;
  now: number;
  posts: string[];
  search: SearchAdapter;
  commentary: (prompt: string) => string;
  calcs: ReadonlyMap<string, (input: unknown) => unknown>;
  jobs: ReadonlyMap<string, (input: unknown) => { ok: boolean; reason?: string }>;
  capHit: boolean;
}

export interface FlowLog {
  id: string;
  type: string;
  ok: boolean;
  detail?: unknown;
}

export type SaveWorkflowResult =
  | { ok: true; workflow: Workflow }
  | { ok: false; reason: "name_required" | "unregistered_calc" | "unregistered_job" | "send_blocked" | "unknown_step" | "disconnected"; detail?: unknown };

export function saveWorkflow(
  raw: unknown,
  registries: Registries,
  templates: ReadonlySet<string>,
  capabilities: { sendEnabled: boolean },
  now = Date.now()
): SaveWorkflowResult {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "disconnected" };
  const name = "name" in raw && typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { ok: false, reason: "name_required" };
  const id = "id" in raw && typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : name;
  const enabled = "enabled" in raw && raw.enabled === true;
  let schedule: Schedule | null = null;
  if ("schedule" in raw && raw.schedule != null) {
    const parsed = saveSchedule(raw.schedule, now);
    if (!parsed.ok) return { ok: false, reason: "disconnected", detail: parsed.detail };
    schedule = parsed.schedule;
  }
  if (!("steps" in raw) || !Array.isArray(raw.steps) || raw.steps.length === 0) {
    return { ok: false, reason: "disconnected" };
  }
  const steps: FlowStep[] = [];
  for (const item of raw.steps) {
    const step = parseStep(item, registries, templates, capabilities);
    if (!step.ok) return step;
    steps.push(step.step);
  }
  const ids = new Set(steps.map((step) => step.id));
  if (ids.size !== steps.length) return { ok: false, reason: "disconnected" };
  for (const step of steps) {
    if ((step.onEmpty && !ids.has(step.onEmpty)) || (step.onMissing && !ids.has(step.onMissing))) {
      return { ok: false, reason: "disconnected", detail: { id: step.id } };
    }
  }
  return { ok: true, workflow: { id, name, enabled, schedule, steps } };
}

export function runWorkflow(workflow: Workflow, world: FlowWorld): {
  ledger: Ledger;
  board: Board;
  posts: string[];
  log: FlowLog[];
  stopped?: { reason: string };
} {
  if (world.capHit) {
    const cardId = `cap-${workflow.id}-${world.now}`;
    const applied = applyCardChange(world.board, {
      create: true,
      id: cardId,
      title: `${workflow.name} を止めた`,
      state: "確認待ち",
      body: TOKEN_CAP_MESSAGE
    }, world.now);
    return {
      ledger: world.ledger,
      board: applied.ok ? applied.board : world.board,
      posts: world.posts,
      log: [{ id: cardId, type: "stop", ok: false, detail: { reason: TOKEN_CAP_MESSAGE } }],
      stopped: { reason: TOKEN_CAP_MESSAGE }
    };
  }
  const steps = workflow.steps;
  const indexById = new Map(steps.map((step, index) => [step.id, index]));
  let ledger = world.ledger;
  let board = world.board;
  const posts = [...world.posts];
  const log: FlowLog[] = [];
  let index = 0;
  let guard = 0;
  while (index < steps.length && guard < steps.length * 4) {
    guard += 1;
    const step = steps[index];
    if (!step) break;
    const outcome = execute(step, { ...world, ledger, board, posts });
    ledger = outcome.ledger;
    board = outcome.board;
    posts.splice(0, posts.length, ...outcome.posts);
    log.push(outcome.log);
    if (outcome.jump) {
      const next = indexById.get(outcome.jump);
      if (next === undefined) break;
      index = next;
      continue;
    }
    index += 1;
  }
  return { ledger, board, posts, log };
}

export function fireDue(
  workflows: readonly Workflow[],
  world: FlowWorld,
  now: number
): FlowWorld & { workflows: Workflow[]; ran: string[]; log: FlowLog[] } {
  let current: FlowWorld = { ...world, now };
  const ran: string[] = [];
  const log: FlowLog[] = [];
  const nextWorkflows: Workflow[] = [];
  for (const workflow of workflows) {
    if (!workflow.enabled || !workflow.schedule) {
      nextWorkflows.push(workflow);
      continue;
    }
    if (!isDue(workflow.schedule, now)) {
      nextWorkflows.push(workflow);
      continue;
    }
    const out = runWorkflow(workflow, current);
    current = { ...current, ledger: out.ledger, board: out.board, posts: out.posts };
    ran.push(workflow.id);
    log.push(...out.log);
    nextWorkflows.push({
      ...workflow,
      schedule: advanceSchedule(workflow.schedule, now)
    });
  }
  return { ...current, workflows: nextWorkflows, ran, log };
}

function parseStep(
  item: unknown,
  registries: Registries,
  templates: ReadonlySet<string>,
  capabilities: { sendEnabled: boolean }
): { ok: true; step: FlowStep } | Exclude<SaveWorkflowResult, { ok: true }> {
  if (!item || typeof item !== "object" || !("type" in item) || typeof item.type !== "string") {
    return { ok: false, reason: "unknown_step" };
  }
  if (!(STEP_TYPES as readonly string[]).includes(item.type)) return { ok: false, reason: "unknown_step", detail: { type: item.type } };
  const id = "id" in item && typeof item.id === "string" ? item.id.trim() : "";
  if (!id) return { ok: false, reason: "disconnected" };
  const type = item.type as StepType;
  const step: FlowStep = { id, type };
  if ("onEmpty" in item && typeof item.onEmpty === "string") step.onEmpty = item.onEmpty;
  if ("onMissing" in item && typeof item.onMissing === "string") step.onMissing = item.onMissing;
  if (type === "run_calc") {
    const name = "name" in item && typeof item.name === "string" ? item.name : "";
    if (!registries.calcs.has(name)) return { ok: false, reason: "unregistered_calc", detail: { name } };
    step.name = name;
    if ("input" in item) step.input = item.input;
  }
  if (type === "start_job") {
    const name = "name" in item && typeof item.name === "string" ? item.name : "";
    if (!registries.jobs.has(name)) return { ok: false, reason: "unregistered_job", detail: { name } };
    step.name = name;
    if ("input" in item) step.input = item.input;
  }
  if (type === "send") {
    const templateId = "templateId" in item && typeof item.templateId === "string" ? item.templateId : "";
    const preview = "preview" in item && typeof item.preview === "string" ? item.preview : "";
    const button = "button" in item && item.button === true;
    if (!templateId || !templates.has(templateId) || preview.trim().length === 0 || !button || !capabilities.sendEnabled) {
      return { ok: false, reason: "send_blocked", detail: { templateId } };
    }
    step.templateId = templateId;
    step.preview = preview;
    step.button = true;
  }
  if (type === "ledger_read" || type === "ledger_write") {
    const kind = "kind" in item ? item.kind : undefined;
    if (kind !== "note" && kind !== "thread_memo") return { ok: false, reason: "disconnected", detail: { id } };
    step.kind = kind;
    if ("recordId" in item && typeof item.recordId === "string") step.recordId = item.recordId;
    if (type === "ledger_write" && !step.recordId) return { ok: false, reason: "disconnected", detail: { id } };
  }
  if (type === "ledger_write" && "fields" in item && item.fields && typeof item.fields === "object") {
    step.fields = item.fields as Record<string, unknown>;
  }
  if (type === "ledger_write" && "version" in item && typeof item.version === "number") step.version = item.version;
  if (type === "kanban_add") {
    const title = "title" in item && typeof item.title === "string" ? item.title : "";
    if (!title) return { ok: false, reason: "disconnected", detail: { id } };
    step.title = title;
  }
  if (type === "kanban_update") {
    const recordId = "recordId" in item && typeof item.recordId === "string" ? item.recordId : "";
    if (!recordId) return { ok: false, reason: "disconnected", detail: { id } };
    step.recordId = recordId;
    if ("state" in item && typeof item.state === "string") step.state = item.state;
  }
  if (type === "thread_post") {
    const text = "text" in item && typeof item.text === "string" ? item.text : "";
    if (!text) return { ok: false, reason: "disconnected", detail: { id } };
    step.text = text;
  }
  if (type === "commentary") {
    const prompt = "prompt" in item && typeof item.prompt === "string" ? item.prompt : "";
    if (!prompt) return { ok: false, reason: "disconnected", detail: { id } };
    step.prompt = prompt;
  }
  if (type === "web_search") {
    const query = "query" in item && typeof item.query === "string" ? item.query : "";
    if (!query) return { ok: false, reason: "disconnected", detail: { id } };
    step.query = query;
  }
  if ("body" in item && typeof item.body === "string") step.body = item.body;
  if ("refs" in item && Array.isArray(item.refs) && item.refs.every((ref) => typeof ref === "string")) step.refs = item.refs;
  return { ok: true, step };
}

function execute(step: FlowStep, world: FlowWorld): { ledger: Ledger; board: Board; posts: string[]; log: FlowLog; jump?: string } {
  if (step.type === "ledger_read") return readLedger(step, world);
  if (step.type === "ledger_write") return writeLedger(step, world);
  if (step.type === "kanban_add" || step.type === "kanban_update") return writeKanban(step, world);
  if (step.type === "thread_post") {
    const posts = [...world.posts, step.text ?? ""];
    return { ledger: world.ledger, board: world.board, posts, log: { id: step.id, type: step.type, ok: true } };
  }
  if (step.type === "commentary") {
    const posts = [...world.posts, world.commentary(step.prompt ?? "")];
    return { ledger: world.ledger, board: world.board, posts, log: { id: step.id, type: step.type, ok: true } };
  }
  if (step.type === "web_search") {
    const outcome = webSearch(0, step.query ?? "", (query) => {
      const raw = world.search(query);
      return raw instanceof Promise ? [] : raw;
    });
    return { ledger: world.ledger, board: world.board, posts: world.posts, log: { id: step.id, type: step.type, ok: outcome.ok, detail: outcome } };
  }
  if (step.type === "run_calc") {
    const fn = step.name ? world.calcs.get(step.name) : undefined;
    if (!fn) return { ledger: world.ledger, board: world.board, posts: world.posts, log: { id: step.id, type: step.type, ok: false, detail: { name: step.name } } };
    const value = fn(step.input);
    const ok = !(value && typeof value === "object" && "ok" in value && value.ok === false);
    return { ledger: world.ledger, board: world.board, posts: world.posts, log: { id: step.id, type: step.type, ok, detail: value } };
  }
  if (step.type === "start_job") {
    const fn = step.name ? world.jobs.get(step.name) : undefined;
    if (!fn) return { ledger: world.ledger, board: world.board, posts: world.posts, log: { id: step.id, type: step.type, ok: false, detail: { name: step.name } } };
    const result = fn(step.input);
    return { ledger: world.ledger, board: world.board, posts: world.posts, log: { id: step.id, type: step.type, ok: result.ok, detail: result } };
  }
  return {
    ledger: world.ledger,
    board: world.board,
    posts: world.posts,
    log: { id: step.id, type: step.type, ok: false, detail: { constraint: "送信段は実行しない" } }
  };
}

function readLedger(step: FlowStep, world: FlowWorld): { ledger: Ledger; board: Board; posts: string[]; log: FlowLog; jump?: string } {
  const id = step.recordId;
  const found = step.kind === "thread_memo"
    ? (id ? world.ledger.memos.get(id) : undefined)
    : (id ? world.ledger.notes.get(id) : undefined);
  const empty = !found || (step.kind === "note" && "deletedAt" in found && found.deletedAt !== null);
  if (empty && step.onEmpty) {
    return { ledger: world.ledger, board: world.board, posts: world.posts, log: { id: step.id, type: step.type, ok: true, detail: { empty: true } }, jump: step.onEmpty };
  }
  return { ledger: world.ledger, board: world.board, posts: world.posts, log: { id: step.id, type: step.type, ok: !empty, detail: { empty } } };
}

function writeLedger(step: FlowStep, world: FlowWorld): { ledger: Ledger; board: Board; posts: string[]; log: FlowLog; jump?: string } {
  const fields = step.fields ?? {};
  const required = step.kind === "thread_memo" ? "memo_body" : "title";
  if (!(required in fields)) {
    return {
      ledger: world.ledger,
      board: world.board,
      posts: world.posts,
      log: { id: step.id, type: step.type, ok: false, detail: { missing: required } },
      jump: step.onMissing
    };
  }
  const committed = commitWrites(world.ledger, [{
    kind: step.kind ?? "note",
    id: step.recordId ?? "",
    fields,
    version: step.version
  }], world.now);
  if (!committed.ok) {
    return { ledger: world.ledger, board: world.board, posts: world.posts, log: { id: step.id, type: step.type, ok: false, detail: committed.detail } };
  }
  return { ledger: committed.ledger, board: world.board, posts: world.posts, log: { id: step.id, type: step.type, ok: true } };
}

function writeKanban(step: FlowStep, world: FlowWorld): { ledger: Ledger; board: Board; posts: string[]; log: FlowLog; jump?: string } {
  const applied = applyCardChange(world.board, step.type === "kanban_add"
    ? { create: true, id: step.id, title: step.title, state: step.state, body: step.body, refs: step.refs, due: step.due }
    : { id: step.recordId ?? "", state: step.state, title: step.title, body: step.body }, world.now);
  if (!applied.ok) {
    return { ledger: world.ledger, board: world.board, posts: world.posts, log: { id: step.id, type: step.type, ok: false, detail: applied.detail } };
  }
  return { ledger: world.ledger, board: applied.board, posts: world.posts, log: { id: step.id, type: step.type, ok: true } };
}
