import { describe, expect, it } from "vitest";
import { createSession, dismissNotice, probeMcpServer, viewOf } from "./session";
import type { McpTransport } from "agent";

describe("MCP probe lastProbe（行内）", () => {
  it("probe 成功は当該サーバの lastProbe に載り、abilityNotice / notice は空", async () => {
    const base = createSession();
    const session = {
      ...base,
      desk: {
        ...base.desk,
        mcpServers: [
          {
            id: "slack",
            name: "Slack",
            url: "https://example.invalid/mcp",
            auth: "none" as const
          }
        ]
      }
    };
    const transport: McpTransport = {
      async listTools(server) {
        return {
          ok: true as const,
          tools: [{ name: "slack_send_message" }, { name: "slack_search_public" }],
          server
        };
      },
      async callTool(server) {
        return { ok: false as const, reason: "unused", server };
      }
    };
    const next = await probeMcpServer(session, "slack", transport);
    const slack = next.desk.mcpServers.find((s) => s.id === "slack");
    expect(slack?.lastProbe).toMatchObject({
      ok: true,
      detail: "2ツール"
    });
    expect(slack?.listedTools).toEqual(["slack_send_message", "slack_search_public"]);
    expect(next.desk.abilityNotice).toBeNull();
    expect(next.desk.notice).toBeNull();
    const view = viewOf(next) as {
      notice: string | null;
      abilityNotice: string | null;
      mcpServers: {
        id: string;
        lastProbe?: { ok: boolean; detail: string };
        listedTools?: string[];
      }[];
    };
    expect(view.notice).toBeNull();
    expect(view.abilityNotice).toBeNull();
    expect(view.mcpServers.find((s) => s.id === "slack")?.lastProbe).toMatchObject({
      ok: true,
      detail: "2ツール"
    });
    expect(view.mcpServers.find((s) => s.id === "slack")?.listedTools).toEqual([
      "slack_send_message",
      "slack_search_public"
    ]);
  });

  it("dismissNotice(ability, id) は lastProbe だけ消し listedTools は残す", async () => {
    const base = createSession();
    const filled = {
      ...base,
      desk: {
        ...base.desk,
        mcpServers: [
          {
            id: "slack",
            name: "Slack",
            url: "https://example.invalid/mcp",
            auth: "none" as const,
            lastProbe: { ok: true, detail: "2ツール", at: 1 },
            listedTools: ["slack_send_message", "slack_search_public"]
          }
        ]
      }
    };
    const cleared = dismissNotice(filled, "ability", "slack");
    expect(cleared.desk.mcpServers[0]?.lastProbe).toBeUndefined();
    expect(cleared.desk.mcpServers[0]?.listedTools).toEqual([
      "slack_send_message",
      "slack_search_public"
    ]);
  });
});
