import { BUILD_ID } from "./build-id";

export type StaleRestore = {
  pane: "chat" | "kanban" | "ability";
  draft: string;
};

export type ReloadPhase = "idle" | "reloading" | "failed";

const RESTORE_KEY = "fudo-build-restore";
const RELOADED_PREFIX = "fudo-build-reloaded:";
const RESTORE_TTL_MS = 10 * 60 * 1000;

type Provider = () => StaleRestore;
let provider: Provider | null = null;
let phase: ReloadPhase = "idle";
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function setPhase(next: ReloadPhase): void {
  phase = next;
  for (const listener of listeners) listener();
}

export function reloadPhase(): ReloadPhase {
  return phase;
}

export function subscribeReloadPhase(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setRestoreProvider(next: Provider): () => void {
  provider = next;
  return () => {
    if (provider === next) provider = null;
  };
}

export function parseRestoreState(raw: string | null, now: number): StaleRestore | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const bag = parsed as { v?: unknown; savedAt?: unknown; state?: Record<string, unknown> } | null;
  if (bag === null || bag.v !== 1 || typeof bag.savedAt !== "number") return null;
  if (now - bag.savedAt > RESTORE_TTL_MS) return null;
  const state = bag.state;
  if (!state || typeof state !== "object") return null;
  const pane = state.pane;
  const draft = state.draft;
  if (pane !== "chat" && pane !== "kanban" && pane !== "ability") return null;
  if (typeof draft !== "string") return null;
  return { pane, draft };
}

/** 起動時に一度だけ読み、読んだら消す。 */
export function takeRestoreState(now = Date.now()): StaleRestore | null {
  const store = storage();
  if (!store) return null;
  const raw = store.getItem(RESTORE_KEY);
  store.removeItem(RESTORE_KEY);
  return parseRestoreState(raw, now);
}

function saveRestoreState(): boolean {
  const store = storage();
  if (!store || !provider) return false;
  try {
    store.setItem(
      RESTORE_KEY,
      JSON.stringify({ v: 1, savedAt: Date.now(), state: provider() })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * 412 を受けたとき。同じサーバー版での自動再読込は 1 回まで。
 * 2 回目は failed にして呼び出し側が再読込ボタンを出す。
 */
export function handleStaleBuildResponse(serverBuild: string | null): ReloadPhase {
  const store = storage();
  const key = `${RELOADED_PREFIX}${serverBuild ?? "unknown"}`;
  if (store?.getItem(key)) {
    setPhase("failed");
    return "failed";
  }
  store?.setItem(key, "1");
  saveRestoreState();
  setPhase("reloading");
  globalThis.location.reload();
  return "reloading";
}

/** 版が揃った起動で、再読込フラグを消す。 */
export function clearReloadedFlag(): void {
  const store = storage();
  if (!store || !BUILD_ID) return;
  store.removeItem(`${RELOADED_PREFIX}${BUILD_ID}`);
}
