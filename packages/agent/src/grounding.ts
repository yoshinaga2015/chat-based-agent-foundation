// 回答文の金額・比率・面積・年数を、ツール結果の数値と突き合わせる。
// 年号、日付、件数、順位は対象外。文は消さない。合わない数値の位置だけを返す。

export type TokenKind = "money" | "rate" | "area" | "years";

export interface NumberToken {
  kind: TokenKind;
  raw: string;
  value: number;
  index: number;
}

const DIGIT = "0-9０-９";
const BODY = `[${DIGIT}]+(?:[.,，．][${DIGIT}]+)?`;

const TOKEN = new RegExp(
  [
    `(?<skipDate>(?:19|20)[${DIGIT}]{2}\\s*年(?:\\s*[${DIGIT}]{1,2}\\s*月(?:\\s*[${DIGIT}]{1,2}\\s*日)?)?)`,
    `(?<skipMeta>${BODY}\\s*(?:件|位|番|ページ|回))`,
    `(?<oku>${BODY}\\s*億(?:\\s*${BODY}\\s*万)?\\s*円?)`,
    `(?<man>${BODY}\\s*万\\s*円?)`,
    `(?<yen>[¥￥]?\\s*${BODY}\\s*円)`,
    `(?<pct>${BODY}\\s*[％%])`,
    `(?<area>${BODY}\\s*(?:㎡|m2|平米|坪))`,
    `(?<years>${BODY}\\s*年)`,
    `(?<bare>(?<![.．])[${DIGIT}](?:[${DIGIT},，]){3,}(?![${DIGIT}]))`
  ].join("|"),
  "g"
);

export function numberTokens(text: string): NumberToken[] {
  const tokens: NumberToken[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    const groups = match.groups ?? {};
    if (groups["skipDate"] || groups["skipMeta"]) continue;
    const raw = match[0];
    if (groups["oku"]) tokens.push({ kind: "money", raw, value: okuMan(groups["oku"]), index });
    else if (groups["man"]) tokens.push({ kind: "money", raw, value: man(groups["man"]), index });
    else if (groups["yen"]) tokens.push({ kind: "money", raw, value: plain(groups["yen"]), index });
    else if (groups["pct"]) tokens.push({ kind: "rate", raw, value: plain(groups["pct"]), index });
    else if (groups["area"]) tokens.push({ kind: "area", raw, value: plain(groups["area"]), index });
    else if (groups["years"]) tokens.push({ kind: "years", raw, value: plain(groups["years"]), index });
    else if (groups["bare"]) tokens.push({ kind: "money", raw: groups["bare"], value: plain(groups["bare"]), index });
  }
  return tokens;
}

/** 出典の数値に載らないトークン。比率は 4.5 と 0.045 を同じとみなす。 */
export function ungroundedTokens(text: string, sources: readonly number[]): NumberToken[] {
  return numberTokens(text).filter((token) => !sources.some((source) => matches(token, source)));
}

function matches(token: NumberToken, source: number): boolean {
  if (close(token.value, source)) return true;
  if (token.kind === "rate") {
    return close(token.value / 100, source) || close(token.value, source * 100);
  }
  return false;
}

function close(a: number, b: number): boolean {
  const gap = Math.abs(a - b);
  return gap <= 1e-9 || gap <= 1e-6 * Math.max(Math.abs(a), Math.abs(b));
}

function okuMan(raw: string): number {
  const [head, tail] = raw.split("億");
  const oku = plain(head ?? "") * 100_000_000;
  const manPart = tail?.includes("万") ? plain(tail) * 10_000 : 0;
  return oku + manPart;
}

function man(raw: string): number {
  return plain(raw) * 10_000;
}

function plain(raw: string): number {
  const cleaned = raw
    .replace(/[¥￥円%％億万㎡坪年]/g, "")
    .replace(/m2|平米/g, "")
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/，/g, "")
    .replace(/．/g, ".")
    .replace(/,/g, "")
    .trim();
  return Number(cleaned);
}
