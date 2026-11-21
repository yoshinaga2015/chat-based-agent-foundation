// 計算とジョブの登録口。名前が無いものはツール一覧にも編集画面にも出さない。
export interface Registries {
  calcs: ReadonlySet<string>;
  jobs: ReadonlySet<string>;
}

export function emptyRegistries(): Registries {
  return { calcs: new Set(), jobs: new Set() };
}

export function registerCalc(registries: Registries, name: string): Registries {
  const calcs = new Set(registries.calcs);
  calcs.add(name);
  return { calcs, jobs: registries.jobs };
}

export function registerJob(registries: Registries, name: string): Registries {
  const jobs = new Set(registries.jobs);
  jobs.add(name);
  return { calcs: registries.calcs, jobs };
}

export function calcChoices(registries: Registries): string[] {
  return [...registries.calcs];
}

export function jobChoices(registries: Registries): string[] {
  return [...registries.jobs];
}

const BASE_TOOLS = [
  "read_records",
  "write_records",
  "activate_skill",
  "read_skill_resource",
  "write_skill_resource",
  "show",
  "propose_plan",
  "web_search",
  "resolve_places",
  "resolve_route",
  "browser_fetch",
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_scroll",
  "browser_select",
  "browser_close",
  "browser_request_handoff",
  "run_code",
  "run_cli",
  "run_agent",
  "mcp_list_tools",
  "mcp_call",
  "mcp_configure",
  "save_skill",
  "kanban_add",
  "kanban_update",
  "delete_item",
  "compare_rows",
  "present_checklist",
  "present_draft",
  "delegate_tasks"
] as const;

/** スキル本文は見ない。登録が無い計算とジョブは渡さない。 */
export function listTools(registries: Registries): string[] {
  const names: string[] = [...BASE_TOOLS];
  if (registries.calcs.size > 0) names.push("run_calc");
  if (registries.jobs.size > 0) names.push("start_job");
  return names;
}
