import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import { BUILD_HEADER, isStaleBuild, resolveServerBuildId, staleBuildHttpResponse } from "./build-id";

describe("isStaleBuild", () => {
  it("サーバー版が無ければ比べない", () => {
    expect(isStaleBuild(null, null)).toBe(false);
    expect(isStaleBuild(null, "a")).toBe(false);
  });

  it("一致すれば新しい", () => {
    expect(isStaleBuild("a", "a")).toBe(false);
  });

  it("不一致・欠落は古い", () => {
    expect(isStaleBuild("a", "b")).toBe(true);
    expect(isStaleBuild("a", null)).toBe(true);
  });
});

describe("resolveServerBuildId", () => {
  it("env を優先する", () => {
    expect(resolveServerBuildId(" from-env ")).toBe("from-env");
  });

  it("空なら null", () => {
    expect(resolveServerBuildId("")).toBe(null);
    expect(resolveServerBuildId(null)).toBe(null);
  });
});

describe("staleBuildHttpResponse", () => {
  it("GET は通す", () => {
    const req = new Request("https://x/api/session", { method: "GET" });
    expect(staleBuildHttpResponse(req, "a")).toBeNull();
  });

  it("版違いの POST は 412", async () => {
    const req = new Request("https://x/api/card", {
      method: "POST",
      headers: { [BUILD_HEADER]: "old" }
    });
    const res = staleBuildHttpResponse(req, "new");
    expect(res?.status).toBe(412);
    expect(res?.headers.get(BUILD_HEADER)).toBe("new");
    expect(await res?.json()).toEqual({ reason: "stale_build" });
  });

  it("版一致の POST は通す", () => {
    const req = new Request("https://x/api/card", {
      method: "POST",
      headers: { [BUILD_HEADER]: "same" }
    });
    expect(staleBuildHttpResponse(req, "same")).toBeNull();
  });
});

describe("build / deploy スクリプト", () => {
  const scripts = (pkg as { scripts: Record<string, string> }).scripts;
  const webBuild = "pnpm --filter web build";

  it.each(["build", "deploy"])("%s は画面と Worker に同じ版を渡す", (name) => {
    const script = scripts[name]!;
    const head = script.slice(0, script.indexOf(webBuild));
    expect(head).not.toBe("");
    const out = execSync(`env -u FUDO_BUILD_ID sh -c '${head}sh -c "printenv FUDO_BUILD_ID" && sh -c "printenv FUDO_BUILD_ID"'`, {
      encoding: "utf8"
    }).split("\n");
    expect(out[0]).toMatch(/^[0-9a-f]+-\d+$/);
    expect(out[1]).toBe(out[0]);
  });
});
