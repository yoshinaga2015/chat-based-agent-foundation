export type ColorPreference = "light" | "dark" | "system";
export type ResolvedColorMode = "light" | "dark";

const STORAGE_KEY = "color-mode";

const ORDER: ColorPreference[] = ["light", "dark", "system"];

export function readColorPreference(): ColorPreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "light";
}

export function resolveColorMode(preference: ColorPreference): ResolvedColorMode {
  if (preference === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return preference;
}

export function applyColorPreference(preference: ColorPreference): ResolvedColorMode {
  const resolved = resolveColorMode(preference);
  document.documentElement.dataset.mode = resolved;
  localStorage.setItem(STORAGE_KEY, preference);
  return resolved;
}

/** `document.documentElement.dataset.mode` を購読（Chart の isDarkMode 用）。 */
export function getResolvedColorMode(): ResolvedColorMode {
  return document.documentElement.dataset.mode === "dark" ? "dark" : "light";
}

export function subscribeResolvedColorMode(onStoreChange: () => void): () => void {
  const root = document.documentElement;
  const observer = new MutationObserver(onStoreChange);
  observer.observe(root, { attributes: true, attributeFilter: ["data-mode"] });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onStoreChange);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onStoreChange);
  };
}

export function nextColorPreference(current: ColorPreference): ColorPreference {
  const index = ORDER.indexOf(current);
  return ORDER[(index + 1) % ORDER.length] ?? "light";
}

export function colorPreferenceLabel(preference: ColorPreference): string {
  if (preference === "light") return "ライト";
  if (preference === "dark") return "ダーク";
  return "システム";
}
