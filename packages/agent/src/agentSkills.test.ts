import { describe, expect, it } from "vitest";
import {
  parseSkillMd,
  resolveSkillResource,
  skillDiscoveryLine,
  skillPackageFromLegacy,
  skillPackageFromSkillMd
} from "./agentSkills";

describe("parseSkillMd", () => {
  it("frontmatter と本文を分ける", () => {
    const raw = `---
name: smoke-echo
description: >
  Echo a short confirmation.
  Use when verifying skills.
---

# smoke-echo

Read references/notes.md.
`;
    const parsed = parseSkillMd(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.frontmatter.name).toBe("smoke-echo");
    expect(parsed.frontmatter.description).toContain("Echo a short confirmation");
    expect(parsed.frontmatter.description).toContain("verifying skills");
    expect(parsed.instructions).toContain("# smoke-echo");
  });

  it("name 制約違反は拒否", () => {
    const parsed = parseSkillMd(`---
name: Bad_Name
description: x
---

body
`);
    expect(parsed.ok).toBe(false);
  });

  it("description 空は拒否", () => {
    const parsed = parseSkillMd(`---
name: ok-name
description: ""
---

body
`);
    expect(parsed.ok).toBe(false);
  });
});

describe("skillPackageFromLegacy", () => {
  it("三欄をパッケージに写す", () => {
    const pkg = skillPackageFromLegacy({
      name: "tactic",
      description: "観点",
      body: "内訳は注意"
    });
    expect(pkg.frontmatter.name).toBe("tactic");
    expect(pkg.instructions).toBe("内訳は注意");
    expect(pkg.resources).toEqual([]);
    expect(skillDiscoveryLine(pkg)).toBe("tactic — 観点");
  });
});

describe("resolveSkillResource", () => {
  it("path 省略は instructions", () => {
    const built = skillPackageFromSkillMd(
      `---
name: smoke-echo
description: test skill for loading
---

# main
`,
      { "references/notes.md": "phrase: fudo-skills-ok" }
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const main = resolveSkillResource(built.skill, undefined);
    expect(main.ok).toBe(true);
    if (main.ok) expect(main.body).toContain("# main");
    const note = resolveSkillResource(built.skill, "references/notes.md");
    expect(note.ok).toBe(true);
    if (note.ok) expect(note.body).toContain("fudo-skills-ok");
  });

  it(".. は拒否", () => {
    const built = skillPackageFromSkillMd(
      `---
name: smoke-echo
description: test skill for loading
---

# main
`,
      { "references/notes.md": "x" }
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(resolveSkillResource(built.skill, "../secret").ok).toBe(false);
  });
});
