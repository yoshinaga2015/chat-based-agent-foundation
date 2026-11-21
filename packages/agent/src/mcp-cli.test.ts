import { describe, expect, it } from "vitest";
import { parseCliAllowList, validateCliArgv } from "./cli";
import { applyPendingMcp, labelPendingMcp, parseHostAllowList, removeMcp, resolveMcpHostAllow, saveMcp, validateMcpUrl, type McpServer } from "./mcp";
import { catalogById, catalogHosts } from "./mcp-catalog";
import { createDesk, deskRemoveMcp, deskResolvePlan, deskSaveMcp } from "./desk";
import { runTurn } from "./turn";

const hosts = ["example.com", "mcp.local"];

describe("MCP 設定のバリデーション", () => {
  it("https と許可ホストだけ通し、http と許可外は拒む", () => {
    expect(validateMcpUrl("https://api.example.com/mcp", hosts).ok).toBe(true);
    expect(validateMcpUrl("http://api.example.com/mcp", hosts).ok).toBe(false);
    expect(validateMcpUrl("https://evil.test/mcp", hosts).ok).toBe(false);
    expect(parseHostAllowList("a.com, B.COM")).toEqual(["a.com", "b.com"]);
  });

  it("saveMcp / removeMcp が一覧を更新する", () => {
    const saved = saveMcp([], { name: "demo", url: "https://api.example.com/mcp" }, hosts);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.servers).toHaveLength(1);
    expect(saved.servers[0]!.auth).toBe("none");
    const removed = removeMcp(saved.servers, saved.servers[0]!.id);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.servers).toHaveLength(0);
  });

  it("カタログホストは env 無しでも許可に入る", () => {
    const allow = resolveMcpHostAllow(undefined, []);
    expect(allow).toContain("mcp.notion.com");
    expect(catalogHosts()).toContain("mcp.notion.com");
    expect(catalogById("notion")?.url).toContain("mcp.notion.com");
  });

  it("カタログ外は確認なしで拒否、確認ありで grantHost", () => {
    const denied = saveMcp([], { name: "x", url: "https://evil.test/mcp" }, hosts);
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.reason).toBe("confirm_host");
    const allowed = saveMcp([], { name: "x", url: "https://evil.test/mcp", confirmUnknownHost: true }, hosts);
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) return;
    expect(allowed.grantHost).toBe("evil.test");
  });

  it("カタログ ID から名称・URL・auth を埋める（OAuth は秘密が要る）", () => {
    const allow = resolveMcpHostAllow(undefined, []);
    const hollow = saveMcp([], { catalogId: "notion" }, allow);
    expect(hollow.ok).toBe(false);
    const saved = saveMcp([], { catalogId: "notion", secret: '{"access_token":"t","client_id":"c","token_endpoint":"https://mcp.notion.com/token","resource":"https://mcp.notion.com"}' }, allow);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.servers[0]).toMatchObject({ id: "notion", name: "Notion", auth: "oauth", catalogId: "notion" });
  });
});

describe("CLI 許可リスト", () => {
  it("既定許可とシェル拒否", () => {
    const allow = parseCliAllowList(undefined);
    expect(allow).toContain("uname");
    expect(validateCliArgv(["uname", "-a"], allow).ok).toBe(true);
    expect(validateCliArgv(["bash", "-lc", "rm -rf /"], allow).ok).toBe(false);
    expect(validateCliArgv(["/bin/ls"], allow).ok).toBe(false);
    expect(validateCliArgv(["curl"], allow).ok).toBe(false);
  });
});

describe("対話の mcp_configure は HITL、能力ペインは即時", () => {
  it("upsert は承認待ちになり、承認で確定する", async () => {
    const now = 1;
    const turn = runTurn({
      ledger: createDesk().ledger,
      now,
      userText: "MCP を追加して",
      mcpHostAllow: hosts,
      steps: [{ calls: [{ name: "mcp_configure", args: { op: "upsert", name: "demo", url: "https://api.example.com/mcp" } }] }]
    });
    expect(turn.ledger.planPending).toBe(true);
    expect(turn.pendingMcp?.op).toBe("upsert");
    expect(turn.mcpServers).toHaveLength(0);
    const desk = {
      ...createDesk(),
      ledger: turn.ledger,
      pendingPlan: turn.pendingPlan,
      pendingMcp: turn.pendingMcp
    };
    const approved = await deskResolvePlan(desk, "approve", now + 1);
    expect(approved.mcpServers).toHaveLength(1);
    expect(approved.ledger.planPending).toBe(false);
    expect(labelPendingMcp({ op: "upsert", server: approved.mcpServers[0]! })).toContain("demo");
  });

  it("能力ペイン相当は即時保存する", async () => {
    const desk = await deskSaveMcp(createDesk(), { name: "ui", url: "https://api.example.com/mcp" }, hosts);
    expect(desk.mcpServers).toHaveLength(1);
    const gone = deskRemoveMcp(desk, desk.mcpServers[0]!.id);
    expect(gone.mcpServers).toHaveLength(0);
  });

  it("run_cli は同期モックで動く", () => {
    const turn = runTurn({
      ledger: createDesk().ledger,
      now: 1,
      userText: "uname",
      cliAllow: ["uname"],
      cli: (argv) => ({ ok: true, stdout: argv.join(" "), stderr: "", exitCode: 0 }),
      steps: [{ calls: [{ name: "run_cli", args: { argv: ["uname", "-a"] } }] }]
    });
    expect(turn.toolLog[0]).toMatchObject({ ok: true, stdout: "uname -a" });
  });

  it("applyPendingMcp の remove が効く", () => {
    const servers = [{ id: "a", name: "a", url: "https://api.example.com/a", auth: "none" as const }];
    const applied = applyPendingMcp(servers, { op: "remove", id: "a" });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.servers).toHaveLength(0);
  });
});

describe("mcp_call は list に無い名前を拒む", () => {
  it("tools/list 外は拒否し、ある名前だけ呼ぶ", async () => {
    const { mcpCallTool } = await import("./mcp-cli-tools");
    const server: McpServer = { id: "demo", name: "demo", url: "https://api.example.com/mcp", auth: "none" };
    const state = {
      mcpServers: [server],
      mcpHostAllow: hosts,
      cliAllow: ["uname"],
      pendingMcp: null,
      planText: null,
      pendingDelete: null,
      planPending: false,
      mcp: {
        listTools: async (item: McpServer) => ({ ok: true as const, tools: [{ name: "ping" }], server: item }),
        callTool: async (item: McpServer, name: string) => ({ ok: true as const, result: { name }, server: item })
      }
    };
    expect(await mcpCallTool(state, { server: "demo", name: "secret" })).toMatchObject({
      ok: false,
      reason: "invalid_value"
    });
    expect(await mcpCallTool(state, { server: "demo", name: "ping" })).toMatchObject({
      ok: true,
      result: { name: "ping" }
    });
  });
});
