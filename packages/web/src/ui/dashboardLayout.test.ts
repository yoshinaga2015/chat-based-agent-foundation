import { describe, expect, it } from "vitest";
import type { DashboardWidget } from "../types";
import {
  dashboardLayoutKey,
  dropPlaceFromPointer,
  moveWidgetOrder,
  reconcileDashboardLayout,
  shiftWidgetOrder
} from "./dashboardLayout";

const widgets: DashboardWidget[] = [
  {
    id: "a",
    span: 1,
    title: "A",
    body: { kind: "chart", chartType: "line", series: [{ name: "x", data: [1] }] }
  },
  {
    id: "b",
    span: 2,
    title: "B",
    body: { kind: "chart", chartType: "bar", series: [{ name: "y", data: [2] }] }
  },
  {
    id: "c",
    span: 1,
    title: "C",
    body: { kind: "metrics", items: [{ id: "m", label: "M", value: "1" }] }
  }
];

describe("dashboardLayout", () => {
  it("key は title と id 集合で安定", () => {
    expect(dashboardLayoutKey("年次", ["noi", "cf"])).toBe(
      dashboardLayoutKey("年次", ["cf", "noi"])
    );
    expect(dashboardLayoutKey("年次", ["noi"])).not.toBe(dashboardLayoutKey("年次", ["cf"]));
  });

  it("prefs なしはマッパ順・span", () => {
    const { visible, prefs } = reconcileDashboardLayout(widgets, null);
    expect(visible.map((w) => w.id)).toEqual(["a", "b", "c"]);
    expect(visible.map((w) => w.span)).toEqual([1, 2, 1]);
    expect(prefs.order).toEqual(["a", "b", "c"]);
  });

  it("order / span / hidden を id で載せる。消えた id は捨て、未知は末尾", () => {
    const { visible, prefs } = reconcileDashboardLayout(widgets, {
      schemaVersion: 1,
      order: ["c", "gone", "a"],
      span: { a: 2, gone: 1 },
      hidden: ["a", "gone"]
    });
    expect(prefs.order).toEqual(["c", "a", "b"]);
    expect(prefs.hidden).toEqual(["a"]);
    expect(visible.map((w) => w.id)).toEqual(["c", "b"]);
    expect(visible.find((w) => w.id === "c")?.span).toBe(1);
    expect(prefs.span.a).toBe(2);
  });

  it("move / shift / after", () => {
    expect(moveWidgetOrder(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveWidgetOrder(["a", "b", "c"], "c", "a", "after")).toEqual(["a", "c", "b"]);
    expect(shiftWidgetOrder(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(shiftWidgetOrder(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
  });

  it("dropPlaceFromPointer は左右・上下で before/after", () => {
    const wide = { left: 0, top: 0, width: 200, height: 80 };
    expect(dropPlaceFromPointer(40, 40, wide)).toBe("before");
    expect(dropPlaceFromPointer(160, 40, wide)).toBe("after");
    const tall = { left: 0, top: 0, width: 80, height: 200 };
    expect(dropPlaceFromPointer(40, 40, tall)).toBe("before");
    expect(dropPlaceFromPointer(40, 160, tall)).toBe("after");
  });
});
