/** Workers バンドル用。Playwright 等 Node 専用モジュールのスタブ。 */
export default {};
export const chromium = {
  launch: async () => {
    throw new Error("playwright_unavailable_on_workers");
  },
  connectOverCDP: async () => {
    throw new Error("playwright_unavailable_on_workers");
  }
};
