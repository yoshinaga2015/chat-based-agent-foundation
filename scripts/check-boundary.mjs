#!/usr/bin/env node
// 殻（agent / session / api / web）はドメインのパッケージを import しない。
// 例外は配備の合成ルートだけ。依存の宣言（package.json）も同じ規則で見る。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const CORE = ["agent", "session", "api", "web"];
const DOMAIN = ["realestate", "slice", "calc", "sheets", "refdata", "exit", "parity", "contracts"];
const COMPOSITION_ROOTS = new Set(["packages/api/src/domain.ts", "packages/web/src/domain.ts"]);
const SOURCE = /\.(ts|tsx|mts|js|mjs)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".wrangler", ".vite", "coverage"]);
const IMPORT = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|(?:^|[\s;])import\s*["']([^"']+)["']/gm;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (SOURCE.test(name)) out.push(path);
  }
  return out;
}

function domainOf(specifier) {
  const head = specifier.split("/")[0];
  return DOMAIN.includes(head) ? head : null;
}

const violations = [];
for (const pkg of CORE) {
  const base = join(root, "packages", pkg);
  const manifest = JSON.parse(readFileSync(join(base, "package.json"), "utf8"));
  const allowedInManifest = pkg === "api" || pkg === "web" ? new Set(["realestate"]) : new Set();
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    for (const dep of Object.keys(manifest[field] ?? {})) {
      if (DOMAIN.includes(dep) && !allowedInManifest.has(dep)) {
        violations.push(`packages/${pkg}/package.json: ${field} に ${dep}`);
      }
    }
  }
  for (const file of walk(base)) {
    const rel = relative(root, file);
    if (COMPOSITION_ROOTS.has(rel)) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(IMPORT)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (!specifier) continue;
      const domain = domainOf(specifier);
      if (domain) violations.push(`${rel}: ${domain} を import`);
      if (specifier.includes("/packages/") || /(^|\/)\.\.\/\.\.\/(realestate|slice|calc|sheets|refdata|exit|parity|contracts)\//.test(specifier)) {
        violations.push(`${rel}: 相対パスでドメインへ (${specifier})`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`境界違反 ${violations.length} 件。殻はドメインを import しない（合成ルート ${[...COMPOSITION_ROOTS].join(", ")} だけ例外）。`);
  for (const line of violations) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`境界チェック OK（殻 ${CORE.join(" / ")}、ドメイン ${DOMAIN.join(" / ")}）`);
