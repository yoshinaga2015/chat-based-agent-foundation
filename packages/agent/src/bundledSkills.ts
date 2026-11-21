/**
 * 製品同梱の Agent Skills（Workers でも fs 無しで載せる）。
 * 正本ファイルは repo の product-skills/。
 * 煙テスト用は本番棚に載せない（SMOKE_SKILL_PACKAGES）。
 */
import { skillPackageFromSkillMd, type SkillPackage } from "./agentSkills";

const SMOKE_ECHO_MD = `---
name: smoke-echo
description: >
  Echo a short confirmation using existing tools only.
  Use when verifying Agent Skills loading in fudo.
---

# smoke-echo

1. Read \`references/notes.md\` via read_skill_resource (path: references/notes.md).
2. Reply with one line that includes the phrase from that file.
3. Do not invent tools. Use only registered tools if any action is needed.
`;

const SMOKE_ECHO_NOTES = `phrase: fudo-skills-ok
`;

function mustPackage(
  raw: string,
  files: Record<string, string>,
  root: string
): SkillPackage {
  const built = skillPackageFromSkillMd(raw, files, root);
  if (!built.ok) {
    throw new Error(`bundled skill ${root}: ${built.reason}`);
  }
  return built.skill;
}

/** 本番ユーザーの初期棚。煙テストは含めない。 */
export const BUNDLED_SKILL_PACKAGES: Readonly<Record<string, SkillPackage>> = {};

/**
 * 検証専用（Vitest・Flow 手動）。desk／turn の既定同梱には入れない。
 * 正本: product-skills/smoke-echo/
 */
export const SMOKE_SKILL_PACKAGES: Readonly<Record<string, SkillPackage>> = {
  "smoke-echo": mustPackage(SMOKE_ECHO_MD, { "references/notes.md": SMOKE_ECHO_NOTES }, "smoke-echo")
};

export function bundledSkillShelf(): Record<string, { name: string; description: string; body: string }> {
  return shelfFromPackages(BUNDLED_SKILL_PACKAGES);
}

/** テスト用: smoke-echo を skills 入力に載せる。 */
export function smokeSkillShelf(): Record<
  string,
  { name: string; description: string; body: string; files?: Record<string, string> }
> {
  const shelf: Record<
    string,
    { name: string; description: string; body: string; files?: Record<string, string> }
  > = {};
  for (const [name, pkg] of Object.entries(SMOKE_SKILL_PACKAGES)) {
    shelf[name] = {
      name: pkg.frontmatter.name,
      description: pkg.frontmatter.description,
      body: pkg.instructions,
      ...(Object.keys(pkg.files).length > 0 ? { files: { ...pkg.files } } : {})
    };
  }
  return shelf;
}

function shelfFromPackages(
  packages: Readonly<Record<string, SkillPackage>>
): Record<string, { name: string; description: string; body: string }> {
  const shelf: Record<string, { name: string; description: string; body: string }> = {};
  for (const [name, pkg] of Object.entries(packages)) {
    shelf[name] = {
      name: pkg.frontmatter.name,
      description: pkg.frontmatter.description,
      body: pkg.instructions
    };
  }
  return shelf;
}
