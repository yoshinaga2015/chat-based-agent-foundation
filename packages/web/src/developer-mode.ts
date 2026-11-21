const STORAGE_KEY = "fudo-developer-mode";

export function readDeveloperMode(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

export function writeDeveloperMode(on: boolean): void {
  localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
}
