import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function fudoBuildIdForDefine(): string | null {
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

const buildId = fudoBuildIdForDefine();
const emptyNode = fileURLToPath(new URL("./src/shims/empty-node.ts", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __FUDO_BUILD_ID__: JSON.stringify(buildId)
  },
  resolve: {
    alias: {
      playwright: emptyNode,
      "playwright-core": emptyNode,
      "chromium-bidi": emptyNode,
      "chromium-bidi/lib/cjs/bidiMapper/BidiMapper": emptyNode
    }
  },
  server: {
    host: "127.0.0.1",
    port: 4174,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4175",
        timeout: 0
      },
      "/oauth": {
        target: "http://127.0.0.1:4175",
        timeout: 0
      }
    }
  }
});
