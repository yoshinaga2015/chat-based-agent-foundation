/** 計画の初期値。環境変数で置き、実測で改める。試験は引数で下げる。 */
export const DAILY_TOKEN_CAP = 2_000_000;
export const TURN_LIMIT_MS = 180_000;
export const TOOL_TIMEOUT_MS = 20_000;
export const MAX_TOOL_CALLS = 40;
export const TOOL_RESULT_CHARS = 8_000;
/** 調査ターンで複数クエリを回せるよう余裕を持つ（Claude 並パリティ設計）。 */
export const WEB_SEARCH_PER_TURN = 8;
export const WEB_SEARCH_RESULTS = 5;
export const WEB_SEARCH_SNIPPET_CHARS = 1_000;
/** search 後の精読。snippet だけで数値断定しないための予算。 */
export const BROWSER_FETCH_PER_TURN = 8;
/** 静的取得失敗時の動的レンダリング上限（URL あたり最大1・ターン合計）。 */
export const BROWSER_RENDER_PER_TURN = 3;
/** 同一ホストへの精読成功の上限（ドメイン分散）。 */
export const MAX_FETCH_SUCCESS_PER_HOST = 2;
export const UNDO_MS = 30 * 24 * 60 * 60 * 1000;
export const MEMO_CHARS = 8_000;
export const NOTE_TITLE_CHARS = 200;

export const TOKEN_CAP_MESSAGE = "本日の利用上限に達しました。明日以降に再度ご利用ください。";
