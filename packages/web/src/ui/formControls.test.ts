import { describe, expect, it } from "vitest";
import { FORM_FIELD_TYPES } from "../types";
import { formFieldSpan, formatFormValue, initialFormValues } from "./formControls";
import { FORM_PATTERNS } from "./formPatterns";

describe("form field catalog", () => {
  it("欄種は13", () => {
    expect(FORM_FIELD_TYPES).toHaveLength(13);
  });

  it("初期値は型に合わせる", () => {
    const values = initialFormValues([
      { id: "a", label: "A", type: "checkbox" },
      { id: "b", label: "B", type: "tags" },
      { id: "c", label: "C", type: "slider", min: 2, max: 10 },
      { id: "d", label: "D", type: "text", value: "x" }
    ]);
    expect(values).toEqual({ a: false, b: [], c: 2, d: "x" });
  });

  it("currency は円表記", () => {
    expect(formatFormValue({ id: "p", label: "価格", type: "currency" }, 1_200_000)).toBe(
      "¥1,200,000"
    );
  });

  it("欄 span の既定と上書き", () => {
    expect(formFieldSpan({ id: "a", label: "A", type: "number" })).toBe(1);
    expect(formFieldSpan({ id: "b", label: "B", type: "textarea" })).toBe(2);
    expect(formFieldSpan({ id: "c", label: "C", type: "number", span: 2 })).toBe(2);
  });

  it("ギャラリーは全欄種をカバー", () => {
    const used = new Set<string>();
    for (const pattern of FORM_PATTERNS) {
      for (const section of pattern.part.sections) {
        for (const field of section.fields) used.add(field.type);
      }
    }
    for (const type of FORM_FIELD_TYPES) {
      expect(used.has(type), `missing type ${type}`).toBe(true);
    }
  });
});
