// レガシー三欄スキル（過渡）。正本は Agent Skills（agentSkills.ts / product-skills/）。
// 指示文であり、ツールは増えない。素材は発話と貼ったメモだけ。
import { MEMO_CHARS } from "./limits";

export interface UserSkill {
  name: string;
  description: string;
  body: string;
  /** Agent Skills の references/scripts 等。省略可。 */
  files?: Record<string, string>;
}

export type SkillMaterial = "utterance" | "memo";

export type SkillResult =
  | { ok: true; skill: UserSkill }
  | { ok: false; reason: "invalid_value"; detail: unknown };

const TOOL_LINE = /(?:^|\n)\s*tools\s*:/i;
const RESOURCE_CHARS = MEMO_CHARS;

export function declaresTools(body: string): boolean {
  return TOOL_LINE.test(body) || /"tools"\s*:/.test(body);
}

export function saveUserSkill(input: {
  name: unknown;
  description: unknown;
  body: unknown;
  material: unknown;
  files?: unknown;
}): SkillResult {
  if (input.material !== "utterance" && input.material !== "memo") {
    return { ok: false, reason: "invalid_value", detail: { constraint: "素材は発話か、貼ったメモだけ" } };
  }
  if (typeof input.name !== "string" || input.name.trim().length === 0 || input.name.length > 80) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "名称は1字以上80字まで" } };
  }
  if (typeof input.description !== "string" || input.description.trim().length === 0) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "利用場面の説明が要る" } };
  }
  if (typeof input.body !== "string" || input.body.length > MEMO_CHARS) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "本文は8000字まで" } };
  }
  if (declaresTools(input.body)) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "スキルからツールは足せない" } };
  }
  const skill: UserSkill = {
    name: input.name.trim(),
    description: input.description.trim(),
    body: input.body
  };
  const files = normalizeSkillFiles(input.files);
  if (files === null) {
    return { ok: false, reason: "invalid_value", detail: { constraint: "files が不正" } };
  }
  if (files && Object.keys(files).length > 0) skill.files = files;
  return { ok: true, skill };
}

/** path → 本文。不正なら null、無しなら undefined。 */
export function normalizeSkillFiles(value: unknown): Record<string, string> | undefined | null {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [path, body] of Object.entries(value as Record<string, unknown>)) {
    const key = path.trim().replace(/^\.\//, "");
    if (!key || key === "SKILL.md" || key.split(/[/\\]/).includes("..") || key.startsWith("/")) {
      return null;
    }
    if (typeof body !== "string" || body.length > RESOURCE_CHARS) return null;
    if (declaresTools(body)) return null;
    out[key] = body;
  }
  return out;
}
