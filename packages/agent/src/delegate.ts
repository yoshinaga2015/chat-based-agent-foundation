/** 委任（並列サブタスク）。子同士は会話しない。成果物だけ親に戻す。 */

import type { UiPart } from "./uiParts";

export const DELEGATE_MAX = 3;

/** 子に許す tool。書き込み・HITL・handoff・再委任は禁止。 */
export const DELEGATE_TOOL_ALLOW = new Set([
  "web_search",
  "browser_fetch",
  "run_calc",
  "compare_rows",
  "present_checklist",
  "present_draft",
  "read_records",
  "resolve_places",
  "resolve_route",
  "mcp_list_tools",
  "mcp_call"
]);

export type DelegateTaskSpec = {
  id: string;
  goal: string;
};

export type DelegateTaskResult = {
  id: string;
  ok: boolean;
  summary: string;
  uiParts: UiPart[];
  numbers: number[];
};

export function parseDelegateTasks(args: unknown): DelegateTaskSpec[] {
  if (!args || typeof args !== "object" || !("tasks" in args) || !Array.isArray((args as { tasks: unknown }).tasks)) {
    return [];
  }
  const out: DelegateTaskSpec[] = [];
  for (const row of (args as { tasks: unknown[] }).tasks) {
    if (!row || typeof row !== "object") continue;
    const id = typeof (row as { id?: unknown }).id === "string" ? (row as { id: string }).id.trim() : "";
    const goal =
      typeof (row as { goal?: unknown }).goal === "string" ? (row as { goal: string }).goal.trim() : "";
    if (!id || !goal) continue;
    out.push({ id: id.slice(0, 64), goal: goal.slice(0, 500) });
    if (out.length >= DELEGATE_MAX) break;
  }
  return out;
}

export async function runDelegateTasks(
  specs: DelegateTaskSpec[],
  runChild: (spec: DelegateTaskSpec) => Promise<DelegateTaskResult>
): Promise<DelegateTaskResult[]> {
  const limited = specs.slice(0, DELEGATE_MAX);
  return Promise.all(limited.map((spec) => runChild(spec)));
}

export function isDelegateAllowedTool(name: string): boolean {
  return DELEGATE_TOOL_ALLOW.has(name);
}
