/** browser_fetch markdown から日付付き数値を決定的に抽出（モデルに再タイプさせない）。 */

export type WebFact = {
  id: string;
  label: string;
  value: string;
  numeric?: number;
  asOf?: string;
};

const FACTS_MAX = 8;

const NUM = "([0-9]{1,3}(?:,[0-9]{3})*(?:\\.[0-9]+)?|[0-9]+(?:\\.[0-9]+)?)";
const MONEY = new RegExp(
  `(?:USD\\s*)?\\$\\s*${NUM}|${NUM}\\s*(?:USD|ドル)`,
  "gi"
);
const YEN = new RegExp(`(?:¥|円)\\s*${NUM}|${NUM}\\s*円`, "gi");

const DATE_ISO = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/;
const DATE_SLASH = /\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/;
const DATE_MDY =
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s*(20\d{2}))?\b/i;
const DATE_JA = /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/;

const LABEL_HINT =
  /(終値|始値|高値|安値|close|open|high|low|price|株価|per|p\/e|時価総額|market\s*cap|出来高|volume)/i;

function parseMoney(raw: string): number | undefined {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function dateFromLine(line: string): string | undefined {
  const iso = DATE_ISO.exec(line);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }
  const ja = DATE_JA.exec(line);
  if (ja) {
    return `${ja[1]}-${ja[2].padStart(2, "0")}-${ja[3].padStart(2, "0")}`;
  }
  const mdy = DATE_MDY.exec(line);
  if (mdy) {
    const months: Record<string, string> = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12"
    };
    const mon = months[mdy[0].slice(0, 3).toLowerCase()];
    const year = mdy[2] ?? String(new Date().getFullYear());
    if (mon) return `${year}-${mon}-${mdy[1].padStart(2, "0")}`;
  }
  const slash = DATE_SLASH.exec(line);
  if (slash) {
    const year = slash[3] ?? String(new Date().getFullYear());
    return `${year}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
  }
  return undefined;
}

function labelFromLine(line: string, fallback: string): string {
  const hint = LABEL_HINT.exec(line);
  if (hint) {
    const clipped = line.replace(/\s+/g, " ").trim().slice(0, 48);
    return clipped || hint[1];
  }
  return fallback;
}

function pushFact(
  out: WebFact[],
  seen: Set<string>,
  fact: Omit<WebFact, "id"> & { id?: string }
): void {
  if (out.length >= FACTS_MAX) return;
  const key = `${fact.asOf ?? ""}:${fact.value}:${fact.label}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({
    id: fact.id ?? `f${out.length + 1}`,
    label: fact.label.slice(0, 64),
    value: fact.value.slice(0, 32),
    ...(fact.numeric !== undefined ? { numeric: fact.numeric } : {}),
    ...(fact.asOf ? { asOf: fact.asOf } : {})
  });
}

/**
 * 行単位で金額／円と日付ヒントを拾う。
 * 金融専用ではなく「通貨記号＋数＋任意の日付」一般。
 */
export function extractWebFacts(markdown: string): WebFact[] {
  const text = markdown.replace(/\r\n/g, "\n").slice(0, 40_000);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const out: WebFact[] = [];
  const seen = new Set<string>();
  let prevDate: string | undefined;

  for (const line of lines) {
    if (out.length >= FACTS_MAX) break;
    const lineDate = dateFromLine(line);
    if (lineDate) prevDate = lineDate;
    const asOf = lineDate ?? prevDate;

    const hasHint = LABEL_HINT.test(line) || Boolean(lineDate);
    if (!hasHint && !/\$|USD|¥|円/.test(line)) continue;

    MONEY.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = MONEY.exec(line)) && out.length < FACTS_MAX) {
      const raw = match[1] ?? match[2] ?? "";
      const numeric = parseMoney(raw);
      if (numeric === undefined) continue;
      if (numeric < 0.01 || numeric > 1e15) continue;
      pushFact(out, seen, {
        label: labelFromLine(line, "値"),
        value: `$${raw}`,
        numeric,
        asOf
      });
    }

    YEN.lastIndex = 0;
    while ((match = YEN.exec(line)) && out.length < FACTS_MAX) {
      const raw = match[1] ?? match[2] ?? "";
      const numeric = parseMoney(raw);
      if (numeric === undefined) continue;
      pushFact(out, seen, {
        label: labelFromLine(line, "金額"),
        value: `¥${raw}`,
        numeric,
        asOf
      });
    }
  }

  return out;
}
