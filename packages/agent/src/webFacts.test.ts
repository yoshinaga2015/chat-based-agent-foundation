import { describe, expect, it } from "vitest";
import { extractWebFacts } from "./webFacts";

describe("extractWebFacts", () => {
  it("日付行の次の Close 金額を asOf 付きで取る", () => {
    const facts = extractWebFacts(`
NVDA quote
Oct 29, 2025
Close $213.66
Volume 12,345
`);
    expect(facts.length).toBeGreaterThanOrEqual(1);
    const close = facts.find((f) => /close/i.test(f.label) || f.value === "$213.66");
    expect(close).toMatchObject({ value: "$213.66", numeric: 213.66 });
    expect(close?.asOf).toMatch(/^2025-10-29$/);
  });

  it("同一行の ISO 日付と終値", () => {
    const facts = extractWebFacts("2025-10-22 終値 $208.12");
    expect(facts[0]).toMatchObject({
      value: "$208.12",
      numeric: 208.12,
      asOf: "2025-10-22"
    });
  });

  it("円表記も取る", () => {
    const facts = extractWebFacts("2025年10月1日 賃料相場 ¥185,000");
    expect(facts.some((f) => f.value === "¥185,000" && f.asOf === "2025-10-01")).toBe(true);
  });

  it("通貨記号の無い裸の数は拾わない", () => {
    const facts = extractWebFacts("Volume 12345678 shares traded today");
    expect(facts).toEqual([]);
  });
});
