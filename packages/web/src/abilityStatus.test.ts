import { describe, expect, it } from "vitest";
import { abilityStatusBadge, mcpConnectionStatus } from "./abilityStatus";

describe("abilityStatus", () => {
  it("null はバッジなし", () => {
    expect(abilityStatusBadge(null)).toBeNull();
  });

  it("4 状態のラベル", () => {
    expect(abilityStatusBadge("active")?.label).toBe("稼働");
    expect(abilityStatusBadge("need_action")?.label).toBe("要対応");
    expect(abilityStatusBadge("error")?.label).toBe("エラー");
  });

  it("MCP は probe 失敗 > 再認証 > 稼働", () => {
    expect(mcpConnectionStatus({ lastProbe: { ok: false }, needsReauth: true })).toBe("error");
    expect(mcpConnectionStatus({ needsReauth: true })).toBe("need_action");
    expect(mcpConnectionStatus({})).toBe("active");
  });
});
