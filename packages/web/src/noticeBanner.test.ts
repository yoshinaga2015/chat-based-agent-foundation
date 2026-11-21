import { describe, expect, it } from "vitest";
import { noticeBannerVariant } from "./noticeBanner";

describe("noticeBannerVariant", () => {
  it("接続成功は default（赤にしない）", () => {
    expect(noticeBannerVariant("接続 OK · 12ツール")).toBe("default");
  });

  it("接続失敗は error", () => {
    expect(noticeBannerVariant("接続失敗: 認証が必要")).toBe("error");
  });

  it("その他の案内は secondary", () => {
    expect(noticeBannerVariant("実行計画を承認した。")).toBe("secondary");
  });
});
