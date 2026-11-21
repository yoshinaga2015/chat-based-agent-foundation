import { describe, expect, it } from "vitest";
import { detectUnusableFetch } from "./fetchUsable";

describe("detectUnusableFetch", () => {
  it("空は使えぬ", () => {
    expect(detectUnusableFetch("")).toBe(true);
    expect(detectUnusableFetch("   \n")).toBe(true);
  });

  it("短い汎用エラーページは使えぬ", () => {
    expect(detectUnusableFetch("Oops, something went wrong. Please try again.")).toBe(true);
    expect(detectUnusableFetch("403 Forbidden\nAccess denied.")).toBe(true);
    expect(detectUnusableFetch("Please enable JavaScript to continue.")).toBe(true);
    expect(detectUnusableFetch("エラーが発生しました。しばらくしてから再度お試しください。")).toBe(true);
  });

  it("通常の数値記事は使える", () => {
    expect(detectUnusableFetch("Close $213.66 on Oct 29, 2025. Volume was high.")).toBe(false);
  });

  it("長文なら障害語があっても通す", () => {
    const body = `Something went wrong in the anecdote.\n\n${"本文です。".repeat(400)}`;
    expect(detectUnusableFetch(body)).toBe(false);
  });
});
