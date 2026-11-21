import { describe, expect, it } from "vitest";
import {
  presentChecklistTool,
  presentDraftTool
} from "./presentSurfaces";
import { mapToolToUiParts } from "./uiParts";
import { runTurn } from "./turn";
import { emptyRegistries } from "./registry";
import { SYSTEM_PROMPT, toolDefs } from "./toolDefs";

const now = Date.parse("2026-10-31T00:00:00Z");

describe("compare_rows / present_checklist / present_draft", () => {


  it("present_checklist は依頼の items から checklist 面を出す", () => {
    const result = presentChecklistTool({
      items: [{ label: "申請" }, { label: "受領" }, { label: "ファイリング" }]
    });
    const parts = mapToolToUiParts("present_checklist", {}, result);
    expect(parts[0]?.kind).toBe("checklist");
    if (parts[0]?.kind === "checklist") {
      expect(parts[0].items.map((i) => i.label)).toEqual(["申請", "受領", "ファイリング"]);
    }
  });

  it("present_checklist は任意の cardId を UiPart に残す", () => {
    const result = presentChecklistTool({
      items: [
        { label: "申請", cardId: "card-reg" },
        { label: "受領" },
        { label: "ファイリング", cardId: "card-reg" }
      ]
    });
    const parts = mapToolToUiParts("present_checklist", {}, result);
    expect(parts[0]?.kind).toBe("checklist");
    if (parts[0]?.kind !== "checklist") return;
    expect(parts[0].items[0]).toMatchObject({ label: "申請", cardId: "card-reg" });
    expect(parts[0].items[1].cardId).toBeUndefined();
    expect(parts[0].items[2]).toMatchObject({ label: "ファイリング", cardId: "card-reg" });
  });

  it("present_draft は body から draft_preview を出す", () => {
    const result = presentDraftTool({ body: "確認のご連絡です。" });
    const parts = mapToolToUiParts("present_draft", {}, result);
    expect(parts[0]?.kind).toBe("draft_preview");
    if (parts[0]?.kind === "draft_preview") {
      expect(parts[0].body).toContain("確認");
    }
  });


});
