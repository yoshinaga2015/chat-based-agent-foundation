import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Cloudflare Vite プラグイン無しで unit 試験する。 */
export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("./src/shims/cloudflare-workers.ts", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
});
