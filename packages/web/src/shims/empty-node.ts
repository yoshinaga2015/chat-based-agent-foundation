/** ブラウザ向けバンドル用。agent の Node 専用経路（Playwright）のスタブ。 */
export default {};
export const chromium = {
  launch: async () => {
    throw new Error("playwright_unavailable_in_browser");
  },
  connectOverCDP: async () => {
    throw new Error("playwright_unavailable_in_browser");
  }
};
