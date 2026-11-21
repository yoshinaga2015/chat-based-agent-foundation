import { describe, expect, it } from "vitest";
import { catalogById, catalogEntryConnectable, publicCatalog } from "./mcp-catalog";

describe("publicCatalog / connectable", () => {
  it("Slack／Figma は事前 client が無いと出さない", () => {
    const without = publicCatalog({});
    expect(without.some((entry) => entry.id === "slack")).toBe(false);
    expect(without.some((entry) => entry.id === "figma")).toBe(false);
    expect(publicCatalog({ FUDO_MCP_OAUTH_CLIENT_SLACK: "slack-app-id" }).some((e) => e.id === "slack")).toBe(
      true
    );
    expect(publicCatalog({ FUDO_MCP_OAUTH_CLIENT_FIGMA: "figma-client" }).some((e) => e.id === "figma")).toBe(
      true
    );
  });

  it("DCR／CIMD または Bearer がある行は env 無しでも出す", () => {
    const ids = publicCatalog({}).map((entry) => entry.id);
    expect(ids).toContain("notion");
    expect(ids).toContain("github");
    expect(ids).not.toContain("figma");
  });

  it("catalogEntryConnectable は事前必須＋oauth-only を判定する", () => {
    const slack = catalogById("slack")!;
    expect(catalogEntryConnectable(slack, {})).toBe(false);
    expect(catalogEntryConnectable(slack, { FUDO_MCP_OAUTH_CLIENT_SLACK: "x" })).toBe(true);
    expect(catalogEntryConnectable(catalogById("github")!, {})).toBe(true);
  });
});
