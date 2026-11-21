/** Playwright / Puppeteer 共通の scroll・select。 */

export type ScrollPage = {
  url(): string;
  title(): Promise<string>;
  evaluate<T>(fn: (arg: { direction: string; amount: number; selector?: string }) => T, arg: {
    direction: string;
    amount: number;
    selector?: string;
  }): Promise<T>;
};

export type SelectPage = {
  url(): string;
  title(): Promise<string>;
  locator(selector: string): {
    first(): {
      selectOption(
        values: string | { label: string } | { value: string },
        options?: { timeout?: number }
      ): Promise<unknown>;
    };
  };
};

export async function scrollOnPage(
  page: ScrollPage,
  target: { direction: "up" | "down"; amount?: number; selector?: string }
): Promise<{ url: string; title: string }> {
  const amount = Math.max(1, Math.min(typeof target.amount === "number" ? target.amount : 600, 4000));
  const delta = target.direction === "up" ? -amount : amount;
  await page.evaluate(
    ({ direction: _d, amount: px, selector }) => {
      type Scrollable = { scrollBy(x: number, y: number): void };
      const page = globalThis as unknown as Scrollable & {
        document: { querySelector(selector: string): Scrollable | null };
      };
      const signed = px;
      if (selector) {
        const el = page.document.querySelector(selector);
        if (el) {
          el.scrollBy(0, signed);
          return;
        }
      }
      page.scrollBy(0, signed);
    },
    { direction: target.direction, amount: delta, selector: target.selector }
  );
  return { url: page.url(), title: await page.title().catch(() => "") };
}

export async function selectOnPage(
  page: SelectPage,
  target: { selector: string; value?: string; label?: string }
): Promise<{ url: string; title: string }> {
  const loc = page.locator(target.selector).first();
  if (target.value) await loc.selectOption(target.value, { timeout: 10_000 });
  else if (target.label) await loc.selectOption({ label: target.label }, { timeout: 10_000 });
  else throw new Error("value か label が要る");
  return { url: page.url(), title: await page.title().catch(() => "") };
}
