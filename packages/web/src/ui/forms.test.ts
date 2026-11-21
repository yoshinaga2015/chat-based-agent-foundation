import { describe, expect, it } from "vitest";
import type { UiPart } from "../types";
import { UI_PART_KINDS, renderUiPart } from "./registry";

const sampleForms: Extract<UiPart, { kind: "forms" }> = {
  kind: "forms",
  title: "前提",
  commit: "speak_summary",
  sections: [
    {
      id: "a",
      span: 1,
      fields: [{ id: "rate", label: "金利", type: "number", value: 1 }]
    },
    {
      id: "b",
      span: 1,
      fields: [{ id: "ok", label: "確認", type: "checkbox", value: false }]
    }
  ]
};

describe("forms GenUI", () => {
  it("カタログに forms がある", () => {
    expect(UI_PART_KINDS).toContain("forms");
  });

  it("onFormCommit 無しでは描画しない", () => {
    expect(renderUiPart(sampleForms)).toBeNull();
  });

  it("onFormCommit 付きで描画する", () => {
    const node = renderUiPart(sampleForms, { onFormCommit: () => {} });
    expect(node).not.toBeNull();
  });
});
