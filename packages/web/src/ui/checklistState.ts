/** checklist の完了トグル（UI State）。契約 UiPart は触らない。 */
export type ChecklistItemState = "pending" | "done" | "blocked";

export type ChecklistPrefs = {
  schemaVersion: 1;
  states: Record<string, ChecklistItemState>;
};

const STORAGE_PREFIX = "fudo.checklistState.v1:";

export function checklistStateKey(threadLineKey: string, partIndex: number): string {
  return `${STORAGE_PREFIX}${threadLineKey}:${partIndex}`;
}

export function readChecklistState(key: string): ChecklistPrefs | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChecklistPrefs>;
    if (parsed.schemaVersion !== 1 || !parsed.states || typeof parsed.states !== "object") return null;
    const states: Record<string, ChecklistItemState> = {};
    for (const [id, state] of Object.entries(parsed.states)) {
      if (state === "pending" || state === "done" || state === "blocked") states[id] = state;
    }
    return { schemaVersion: 1, states };
  } catch {
    return null;
  }
}

export function writeChecklistState(key: string, prefs: ChecklistPrefs): void {
  try {
    localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    /* quota / private mode */
  }
}

export function mergeChecklistStates(
  items: { id: string; state: ChecklistItemState }[],
  prefs: ChecklistPrefs | null
): Record<string, ChecklistItemState> {
  const out: Record<string, ChecklistItemState> = {};
  for (const item of items) {
    out[item.id] = prefs?.states[item.id] ?? item.state;
  }
  return out;
}
