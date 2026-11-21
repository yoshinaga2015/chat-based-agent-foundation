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
    expect(noticeBannerVariant("実行計画を承認しました")).toBe("secondary");
    expect(noticeBannerVariant("変更を破棄しました。書類やリポジトリは変更されていません。")).toBe("secondary");
  });

  it("敬体のエラー・制限文言も error になる", () => {
    expect(noticeBannerVariant("メッセージは 20,000 文字以内で入力してください")).toBe("error");
    expect(noticeBannerVariant("対応していないファイル形式です")).toBe("error");
    expect(noticeBannerVariant("このモデルは選択できません")).toBe("error");
    expect(noticeBannerVariant("指定された MCP サーバーが見つかりません")).toBe("error");
    expect(noticeBannerVariant("中断されたため、保留中の変更を破棄しました")).toBe("error");
  });
});
