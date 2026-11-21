import { describe, expect, it } from "vitest";
import { formatMcpProbeReason } from "./mcpReasons";

describe("formatMcpProbeReason", () => {
  it("oauth_required は OAuth 未接続", () => {
    expect(formatMcpProbeReason("oauth_required")).toBe("OAuth 未接続");
  });

  it("bearer_required は Bearer トークン未設定", () => {
    expect(formatMcpProbeReason("bearer_required")).toBe("Bearer トークン未設定");
  });

  it("mcp_unreachable はサーバー応答なし", () => {
    expect(formatMcpProbeReason("mcp_unreachable")).toBe("サーバー応答なし");
  });

  it("timeout はタイムアウト", () => {
    expect(formatMcpProbeReason("timeout")).toBe("タイムアウト");
  });

  it("http ステータスコードを整形", () => {
    expect(formatMcpProbeReason("http_404")).toBe("HTTP 404 エラー");
  });

  it("未知は短くそのまま", () => {
    expect(formatMcpProbeReason("weird_code")).toBe("weird_code");
  });
});
