import { describe, expect, it } from "vitest";
import { shouldClearActivityOnClose, shouldClearClientProgressOnStreamEnd } from "./progress-owner";

describe("shouldClearClientProgressOnStreamEnd", () => {
  it("done を受けていれば消さない", () => {
    expect(shouldClearClientProgressOnStreamEnd(true)).toBe(false);
  });

  it("done 無しでストリームが終わったら消す", () => {
    expect(shouldClearClientProgressOnStreamEnd(false)).toBe(true);
  });
});

describe("shouldClearActivityOnClose", () => {
  it("サーバー起点は消さない", () => {
    expect(
      shouldClearActivityOnClose({
        kind: "server",
        ownerConnectionId: null,
        closedConnectionId: "a",
        openConnectionIds: new Set()
      })
    ).toBe(false);
  });

  it("持ち主の切断で、同じ id が開いていなければ消す", () => {
    expect(
      shouldClearActivityOnClose({
        kind: "client",
        ownerConnectionId: "a",
        closedConnectionId: "a",
        openConnectionIds: new Set()
      })
    ).toBe(true);
  });

  it("つなぎ直しで同じ id が開いていれば消さない", () => {
    expect(
      shouldClearActivityOnClose({
        kind: "client",
        ownerConnectionId: "a",
        closedConnectionId: "a",
        openConnectionIds: new Set(["a"])
      })
    ).toBe(false);
  });

  it("他の接続の切断では消さない", () => {
    expect(
      shouldClearActivityOnClose({
        kind: "client",
        ownerConnectionId: "a",
        closedConnectionId: "b",
        openConnectionIds: new Set(["a"])
      })
    ).toBe(false);
  });
});
