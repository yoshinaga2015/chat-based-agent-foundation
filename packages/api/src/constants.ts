export const STUB_USER_ID = "local";

/** 開発 SPA（Vite）。本番 Origin は FUDO_ALLOWED_ORIGINS で追加。 */
export const DEFAULT_ALLOWED_ORIGINS = [
  "http://127.0.0.1:4174",
  "http://localhost:4174",
  "http://127.0.0.1:5173",
  "http://localhost:5173"
] as const;

/** @deprecated 互換用。実行時は allowedOriginsFromEnv を使う。 */
export const ALLOWED_ORIGINS = DEFAULT_ALLOWED_ORIGINS;
