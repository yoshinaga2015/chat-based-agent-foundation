/** vite.config と cloudflare ビルドが共有する版の値。同一シェルで同じ値になるよう process.env に載せる。 */
import { execSync } from "node:child_process";

export function fudoBuildIdForDefine(): string | null {
  const fromEnv = process.env.FUDO_BUILD_ID?.trim();
  if (fromEnv) return fromEnv;
  const isBuild = process.argv.includes("build") || process.env.NODE_ENV === "production";
  if (!isBuild) return null;
  if (!process.env.FUDO_BUILD_ID_GENERATED) {
    let short = "local";
    try {
      short = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim() || short;
    } catch {
      // git が無い環境
    }
    process.env.FUDO_BUILD_ID_GENERATED = `${short}-${Date.now()}`;
  }
  return process.env.FUDO_BUILD_ID_GENERATED;
}
