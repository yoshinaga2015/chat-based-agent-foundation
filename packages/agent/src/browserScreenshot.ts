/** Playwright Page から活動プレビュー用 JPEG を撮る。 */

type Page = import("playwright").Page;

export type BrowserScreenshot = { mime: "image/jpeg"; base64: string };

const MAX_BYTES = 40_000;

/** quality を下げつつ 40KB 未満を狙う。失敗時 null。 */
export async function screenshotPage(page: Page): Promise<BrowserScreenshot | null> {
  try {
    for (const quality of [48, 36, 28, 20]) {
      const buf = await page.screenshot({ type: "jpeg", quality, scale: "css" });
      if (buf.byteLength <= MAX_BYTES || quality === 20) {
        return { mime: "image/jpeg", base64: buf.toString("base64") };
      }
    }
  } catch {
    return null;
  }
  return null;
}
