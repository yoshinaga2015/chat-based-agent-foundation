/** Agent Skills（agentskills.io）形式のパースとレガシー三欄からの変換。 */
import type { UserSkill } from "./skills";

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type SkillFrontmatter = {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  /** 実験的。許可の縮小にだけ使う。 */
  allowedTools?: string[];
};

export type SkillPackage = {
  /** 論理根（例: smoke-echo） */
  root: string;
  frontmatter: SkillFrontmatter;
  /** SKILL.md の Markdown 本文（frontmatter 除く） */
  instructions: string;
  /** ルート相対パス（SKILL.md 以外）。読取許可リスト */
  resources: string[];
  /** path → 本文。同梱資源 */
  files: Record<string, string>;
};

export type ParseSkillMdResult =
  | { ok: true; frontmatter: SkillFrontmatter; instructions: string }
  | { ok: false; reason: string };

/**
 * 最小 YAML frontmatter（`---` 囲み）。折りたたみ `>` / `>-` と単純 key: value のみ。
 * 依存を増やさないためのサブセット。
 */
export function parseSkillMd(raw: string): ParseSkillMdResult {
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) {
    return { ok: false, reason: "frontmatter が無い" };
  }
  const end = text.indexOf("\n---", 3);
  if (end < 0) {
    return { ok: false, reason: "frontmatter が閉じていない" };
  }
  const yaml = text.slice(3, end).replace(/^\n/, "");
  const instructions = text.slice(end + 4).replace(/^\n/, "");
  const map = parseSimpleYaml(yaml);
  if (!map) {
    return { ok: false, reason: "frontmatter を解釈できない" };
  }
  const name = typeof map.name === "string" ? map.name.trim() : "";
  const description = typeof map.description === "string" ? map.description.trim() : "";
  if (!name || name.length > 64 || !NAME_RE.test(name)) {
    return { ok: false, reason: "name が不正" };
  }
  if (!description || description.length > 1024) {
    return { ok: false, reason: "description が不正" };
  }
  const frontmatter: SkillFrontmatter = { name, description };
  if (typeof map.license === "string" && map.license.trim()) {
    frontmatter.license = map.license.trim();
  }
  if (typeof map.compatibility === "string" && map.compatibility.trim()) {
    frontmatter.compatibility = map.compatibility.trim().slice(0, 500);
  }
  if (map.metadata && typeof map.metadata === "object" && !Array.isArray(map.metadata)) {
    const metadata: Record<string, string> = {};
    for (const [key, value] of Object.entries(map.metadata)) {
      if (typeof value === "string") metadata[key] = value;
    }
    if (Object.keys(metadata).length > 0) frontmatter.metadata = metadata;
  }
  const toolsRaw = map["allowed-tools"] ?? map.allowedTools;
  if (typeof toolsRaw === "string" && toolsRaw.trim()) {
    frontmatter.allowedTools = toolsRaw
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }
  return { ok: true, frontmatter, instructions };
}

export function skillPackageFromLegacy(skill: UserSkill): SkillPackage {
  const files = { ...(skill.files ?? {}) };
  const resources = Object.keys(files)
    .filter((path) => path !== "SKILL.md" && !path.split(/[/\\]/).includes(".."))
    .sort();
  return {
    root: skill.name,
    frontmatter: {
      name: skill.name,
      description: skill.description
    },
    instructions: skill.body,
    resources,
    files
  };
}

/** 同梱を土台に、ユーザー編集（description / instructions / files）を重ねる。 */
export function mergeSkillPackage(base: SkillPackage | undefined, skill: UserSkill): SkillPackage {
  const legacy = skillPackageFromLegacy(skill);
  if (!base) return legacy;
  const files = { ...base.files, ...legacy.files };
  const resources = Object.keys(files)
    .filter((path) => path !== "SKILL.md")
    .sort();
  return {
    root: base.root,
    frontmatter: {
      ...base.frontmatter,
      name: skill.name,
      description: skill.description
    },
    instructions: skill.body,
    resources,
    files
  };
}

export function skillPackageFromSkillMd(
  raw: string,
  files: Record<string, string> = {},
  root?: string
): { ok: true; skill: SkillPackage } | { ok: false; reason: string } {
  const parsed = parseSkillMd(raw);
  if (!parsed.ok) return parsed;
  const resources = Object.keys(files)
    .filter((path) => path !== "SKILL.md" && !pathIncludesDotDot(path))
    .sort();
  return {
    ok: true,
    skill: {
      root: root ?? parsed.frontmatter.name,
      frontmatter: parsed.frontmatter,
      instructions: parsed.instructions,
      resources,
      files
    }
  };
}

/** Discovery 用の一行。instructions は載せない。 */
export function skillDiscoveryLine(pkg: SkillPackage): string {
  return `${pkg.frontmatter.name} — ${pkg.frontmatter.description}`;
}

export function resolveSkillResource(
  pkg: SkillPackage,
  path: string | undefined
): { ok: true; body: string; path: string } | { ok: false; reason: string } {
  if (!path || !path.trim()) {
    return { ok: true, body: pkg.instructions, path: "SKILL.md" };
  }
  const normalized = path.trim().replace(/^\.\//, "");
  if (pathIncludesDotDot(normalized) || normalized.startsWith("/")) {
    return { ok: false, reason: "path が不正" };
  }
  if (normalized === "SKILL.md") {
    return { ok: true, body: pkg.instructions, path: normalized };
  }
  if (!pkg.resources.includes(normalized) && !(normalized in pkg.files)) {
    return { ok: false, reason: "resource_not_found" };
  }
  const body = pkg.files[normalized];
  if (typeof body !== "string") {
    return { ok: false, reason: "resource_not_found" };
  }
  return { ok: true, body, path: normalized };
}

function pathIncludesDotDot(path: string): boolean {
  return path.split(/[/\\]/).some((part) => part === "..");
}

type YamlValue = string | Record<string, YamlValue>;

function parseSimpleYaml(yaml: string): Record<string, YamlValue> | null {
  const out: Record<string, YamlValue> = {};
  const lines = yaml.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim() || line.trimStart().startsWith("#")) {
      i += 1;
      continue;
    }
    if (/^\s/.test(line)) {
      return null;
    }
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) return null;
    const key = match[1]!;
    const rest = match[2] ?? "";
    if (rest === ">" || rest === ">-" || rest === "|" || rest === "|-") {
      const block: string[] = [];
      i += 1;
      while (i < lines.length) {
        const next = lines[i] ?? "";
        if (next.trim() === "") {
          block.push("");
          i += 1;
          continue;
        }
        if (!/^\s+/.test(next)) break;
        block.push(next.replace(/^\s+/, ""));
        i += 1;
      }
      out[key] = block.join(" ").replace(/\s+/g, " ").trim();
      continue;
    }
    if (rest === "" || rest === "{}") {
      // nested map one level
      const nested: Record<string, YamlValue> = {};
      i += 1;
      while (i < lines.length) {
        const next = lines[i] ?? "";
        if (!/^\s+\S/.test(next)) break;
        const nestedMatch = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(next);
        if (!nestedMatch) return null;
        nested[nestedMatch[1]!] = stripQuotes(nestedMatch[2] ?? "");
        i += 1;
      }
      out[key] = nested;
      continue;
    }
    out[key] = stripQuotes(rest);
    i += 1;
  }
  return out;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
