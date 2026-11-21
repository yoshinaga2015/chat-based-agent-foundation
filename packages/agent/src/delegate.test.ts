import { describe, expect, it } from "vitest";
import {
  DELEGATE_MAX,
  isDelegateAllowedTool,
  parseDelegateTasks,
  runDelegateTasks
} from "./delegate";

describe("runDelegateTasks", () => {
  it("4件目は受け取らず 3件まで", async () => {
    const specs = [1, 2, 3, 4].map((n) => ({ id: `t${n}`, goal: `g${n}` }));
    const ran: string[] = [];
    const results = await runDelegateTasks(specs, async (spec) => {
      ran.push(spec.id);
      return { id: spec.id, ok: true, summary: "ok", uiParts: [], numbers: [] };
    });
    expect(ran).toHaveLength(DELEGATE_MAX);
    expect(results).toHaveLength(DELEGATE_MAX);
  });
});

describe("parseDelegateTasks", () => {
  it("不正行を落とし id/goal を切る", () => {
    expect(
      parseDelegateTasks({
        tasks: [
          { id: "a", goal: "調べる" },
          { id: "", goal: "x" },
          { goal: "no-id" }
        ]
      })
    ).toEqual([{ id: "a", goal: "調べる" }]);
  });
});

describe("isDelegateAllowedTool", () => {
  it("書き込みと handoff は禁止", () => {
    expect(isDelegateAllowedTool("web_search")).toBe(true);
    expect(isDelegateAllowedTool("write_records")).toBe(false);
    expect(isDelegateAllowedTool("browser_request_handoff")).toBe(false);
    expect(isDelegateAllowedTool("delegate_tasks")).toBe(false);
  });
});
