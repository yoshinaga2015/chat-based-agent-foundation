import { describe, expect, it } from "vitest";
import { audienceForUiPartKind, isUserFacingUiPart } from "./uiAudience";

describe("uiAudience", () => {
  it("job_progress は既定 internal", () => {
    expect(audienceForUiPartKind("job_progress")).toBe("internal");
    expect(isUserFacingUiPart({ kind: "job_progress" })).toBe(false);
  });

  it("sources は既定 user", () => {
    expect(audienceForUiPartKind("sources")).toBe("user");
    expect(isUserFacingUiPart({ kind: "sources" })).toBe(true);
  });

  it("meta.audience が kind 既定を上書き", () => {
    expect(isUserFacingUiPart({ kind: "job_progress", audience: "user" })).toBe(true);
    expect(isUserFacingUiPart({ kind: "sources", audience: "internal" })).toBe(false);
  });
});
