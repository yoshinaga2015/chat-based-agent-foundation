import type { BrowserClickTarget } from "./browserSession";

type Page = import("playwright").Page;

const CLICK_MS = 15_000;

/** accessible name 優先、だめなら selector。 */
export async function clickWithPlaywright(page: Page, target: BrowserClickTarget): Promise<void> {
  const name = target.name?.trim();
  const selector = target.selector?.trim();
  const role = target.role?.trim().toLowerCase();

  if (name) {
    const roles = role ? [role] : ["button", "link", "checkbox"];
    for (const r of roles) {
      const loc = page.getByRole(r as "button", { name, exact: false }).first();
      try {
        await loc.waitFor({ state: "visible", timeout: 4_000 });
        await loc.click({ timeout: CLICK_MS });
        return;
      } catch {
        // try next role
      }
    }
    const byText = page.getByText(name, { exact: true }).first();
    await byText.click({ timeout: CLICK_MS });
    return;
  }

  if (!selector) throw new Error("name か selector が要る");
  await page.locator(selector).first().click({ timeout: CLICK_MS });
}
