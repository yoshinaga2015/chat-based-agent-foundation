/** 設定不足の案内。値は出さず、足りない名前だけを説明に置く。 */

const STORAGE_KEY = "fudo.dismissedCapabilityGaps.v1";

export function capabilityGapSignature(gap: { id: string; missing: string[] }): string {
  return `${gap.id}\n${[...gap.missing].join("\n")}`;
}

export function capabilityGapCopy(gap: { label: string; missing: string[] }): {
  title: string;
  description: string;
} {
  const glue = /[A-Za-z0-9]$/.test(gap.label) ? " " : "";
  return {
    title: `${gap.label}${glue}を利用するには環境変数の設定が必要です`,
    description: `未設定: ${gap.missing.join(", ")}`
  };
}

export function readDismissedCapabilityGaps(storage: Pick<Storage, "getItem">): Set<string> {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return new Set();
  }
}

export function writeDismissedCapabilityGaps(
  signatures: Iterable<string>,
  storage: Pick<Storage, "setItem">
): void {
  storage.setItem(STORAGE_KEY, JSON.stringify([...signatures]));
}
