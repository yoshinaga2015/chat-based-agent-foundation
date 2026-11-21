// 四則だけの実行。台帳も秘密情報もネットワークも持たない。
export const CODE_BADGE = "コード算出" as const;

export type CodeResult =
  | { ok: true; value: number; badge: typeof CODE_BADGE }
  | { ok: false; reason: "invalid_value"; detail: { constraint: string } };

export function runCode(source: string): CodeResult {
  if (/[A-Za-z_$]/.test(source) || source.includes("`")) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "四則だけを実行する" } };
  }
  try {
    const parser = new Parser(tokenize(source));
    const value = parser.parseExpression();
    parser.end();
    if (!Number.isFinite(value)) return { ok: false, reason: "invalid_value", detail: { constraint: "有限の数値だけを返す" } };
    return { ok: true, value, badge: CODE_BADGE };
  } catch (error) {
    const constraint = error instanceof Error ? error.message : "式を読めなかった";
    return { ok: false, reason: "invalid_value", detail: { constraint } };
  }
}

type Token = { kind: "num"; value: number } | { kind: "op"; value: "+" | "-" | "*" | "/" | "(" | ")" };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === " " || char === "\n" || char === "\t") {
      i += 1;
      continue;
    }
    if (char === "+" || char === "-" || char === "*" || char === "/" || char === "(" || char === ")") {
      tokens.push({ kind: "op", value: char });
      i += 1;
      continue;
    }
    if (char !== undefined && char >= "0" && char <= "9") {
      let end = i + 1;
      while (end < source.length) {
        const next = source[end];
        if (next === undefined || next < "0" || next > "9") break;
        if (next === ".") break;
        end += 1;
      }
      if (source[end] === ".") {
        end += 1;
        while (end < source.length) {
          const next = source[end];
          if (next === undefined || next < "0" || next > "9") break;
          end += 1;
        }
      }
      const value = Number(source.slice(i, end));
      if (!Number.isFinite(value)) throw new Error("数値を読めなかった");
      tokens.push({ kind: "num", value });
      i = end;
      continue;
    }
    throw new Error("四則だけを実行する");
  }
  return tokens;
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parseExpression(): number {
    let value = this.parseTerm();
    while (this.match("+") || this.match("-")) {
      const op = this.previousOp();
      const right = this.parseTerm();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }

  end(): void {
    if (this.index < this.tokens.length) throw new Error("式を読めなかった");
  }

  private parseTerm(): number {
    let value = this.parseUnary();
    while (this.match("*") || this.match("/")) {
      const op = this.previousOp();
      const right = this.parseUnary();
      if (op === "/" && right === 0) throw new Error("ゼロでは割れない");
      value = op === "*" ? value * right : value / right;
    }
    return value;
  }

  private parseUnary(): number {
    if (this.match("-")) return -this.parseUnary();
    if (this.match("+")) return this.parseUnary();
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const token = this.tokens[this.index];
    if (token?.kind === "num") {
      this.index += 1;
      return token.value;
    }
    if (token?.kind === "op" && token.value === "(") {
      this.index += 1;
      const value = this.parseExpression();
      if (!this.match(")")) throw new Error("括弧が閉じない");
      return value;
    }
    throw new Error("式を読めなかった");
  }

  private match(op: string): boolean {
    const token = this.tokens[this.index];
    if (token?.kind === "op" && token.value === op) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private previousOp(): string {
    const token = this.tokens[this.index - 1];
    if (token?.kind !== "op") throw new Error("式を読めなかった");
    return token.value;
  }
}
