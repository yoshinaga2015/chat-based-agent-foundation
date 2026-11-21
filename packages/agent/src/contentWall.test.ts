import { describe, expect, it } from "vitest";
import { detectContentWall } from "./contentWall";

describe("detectContentWall", () => {
  it("短い本文＋ Subscribe to continue は壁", () => {
    expect(detectContentWall("Subscribe to continue reading.\n\nTeaser.")).toBe(true);
  });

  it("有料会員の短い誘導は壁", () => {
    expect(detectContentWall("続きを読むには有料会員登録が必要です。")).toBe(true);
  });

  it("長文本文があれば壁文言があっても通す", () => {
    const body = `Sign in to continue\n\n${"本文です。".repeat(400)}`;
    expect(detectContentWall(body)).toBe(false);
  });

  it("通常の記事は壁ではない", () => {
    expect(detectContentWall("Close $213.66 on Oct 29, 2025. Volume was high.")).toBe(false);
  });
});
