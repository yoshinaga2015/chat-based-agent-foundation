import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import { fudoBuildIdForDefine } from "./src/vite-build-id";

const buildId = fudoBuildIdForDefine();
const root = path.dirname(fileURLToPath(import.meta.url));
const emptyNode = path.join(root, "src/shims/empty-node.ts");

export default defineConfig({
  plugins: [cloudflare()],
  // 本番の画面は web の build（`pnpm --filter web build`）を静的アセットとして同じ Worker から配る。
  publicDir: path.join(root, "../web/dist"),
  define: {
    __FUDO_BUILD_ID__: JSON.stringify(buildId)
  },
  resolve: {
    // agent の Node sidecar（Playwright）が Workers グラフに混入しても解決できるようにする
    alias: {
      playwright: emptyNode,
      "playwright-core": emptyNode,
      "chromium-bidi": emptyNode,
      "chromium-bidi/lib/cjs/bidiMapper/BidiMapper": emptyNode
    }
  },
  server: {
    host: "127.0.0.1",
    port: 4175,
    strictPort: true
  }
});
