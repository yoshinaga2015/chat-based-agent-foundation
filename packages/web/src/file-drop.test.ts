import { describe, expect, it } from "vitest";
import { isFileDrag, leftDropZone } from "./file-drop";

describe("isFileDrag", () => {
  it("ファイルのドラッグを受ける", () => {
    expect(isFileDrag(["Files"])).toBe(true);
  });

  it("文字のドラッグは受けない", () => {
    expect(isFileDrag(["text/plain", "text/html"])).toBe(false);
  });
});

describe("leftDropZone", () => {
  const inner = {};
  const zone = { contains: (node: unknown) => node === inner };

  it("受け口の内側の要素へ移っただけなら、出たとみなさない", () => {
    expect(leftDropZone(zone, inner)).toBe(false);
  });

  it("受け口の外の要素へ移ったら出たとみなす", () => {
    expect(leftDropZone(zone, {})).toBe(true);
  });

  it("ブラウザの外へ出たら出たとみなす", () => {
    expect(leftDropZone(zone, null)).toBe(true);
  });
});
