// CLI 許可リストと argv 検証。Container 実行アダプタは Worker 側。

export type CliRunResult =
  | { ok: true; stdout: string; stderr: string; exitCode: number }
  | { ok: false; reason: string; detail?: { constraint: string } };

export type CliRunner = (argv: string[]) => Promise<CliRunResult>;

const DEFAULT_ALLOW = ["uname", "date", "ls", "cat", "pwd", "echo"] as const;

export function parseCliAllowList(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [...DEFAULT_ALLOW];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function validateCliArgv(argv: unknown, allow: readonly string[]): { ok: true; argv: string[] } | { ok: false; constraint: string } {
  if (!Array.isArray(argv) || argv.length === 0) {
    return { ok: false, constraint: "argv は空でない配列" };
  }
  if (!argv.every((item) => typeof item === "string")) {
    return { ok: false, constraint: "argv の要素は文字列" };
  }
  const parts = argv.map((item) => item as string);
  if (parts.some((part) => part.includes("\0"))) {
    return { ok: false, constraint: "argv にヌルは不可" };
  }
  const bin = parts[0]!;
  if (bin.includes("/") || bin === "bash" || bin === "sh" || bin === "zsh") {
    return { ok: false, constraint: "シェルやパス付き実行は不可" };
  }
  if (!allow.includes(bin)) {
    return { ok: false, constraint: `コマンド ${bin} は許可リスト外` };
  }
  return { ok: true, argv: parts };
}

export function unavailableCliRunner(): CliRunner {
  return async () => ({ ok: false, reason: "cli_unavailable", detail: { constraint: "この環境では CLI を実行できない" } });
}

export function mockCliRunner(handler: (argv: string[]) => CliRunResult | Promise<CliRunResult>): CliRunner {
  return async (argv) => handler(argv);
}
