/** 画面と Worker が同じビルドから出たかを確かめる版の値（段J / プロトタイプ #310）。 */

declare const __FUDO_BUILD_ID__: string | undefined;

/** vite build の define、または実行時の FUDO_BUILD_ID。dev／テストで無ければ null で比べない。 */
export function resolveServerBuildId(envBuild?: string | null): string | null {
  const fromEnv = typeof envBuild === "string" && envBuild.trim() ? envBuild.trim() : null;
  if (fromEnv) return fromEnv;
  if (typeof __FUDO_BUILD_ID__ === "string" && __FUDO_BUILD_ID__.trim()) return __FUDO_BUILD_ID__.trim();
  return null;
}

export const BUILD_HEADER = "x-fudo-build";
export const STALE_BUILD_STATUS = 412;

/**
 * サーバーの版と画面の版が食い違うか。サーバーの版が無いときは比べない。
 * 版を送らない画面は、仕組み導入前の画面なので食い違いとする。
 */
export function isStaleBuild(serverBuild: string | null, clientBuild: string | null): boolean {
  if (serverBuild === null) return false;
  return clientBuild !== serverBuild;
}

/** 版が違う変更系 HTTP なら 412。GET／HEAD は比べない。 */
export function staleBuildHttpResponse(request: Request, serverBuild: string | null): Response | null {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return null;
  const clientBuild = request.headers.get(BUILD_HEADER);
  if (!isStaleBuild(serverBuild, clientBuild)) return null;
  return Response.json(
    { reason: "stale_build" },
    { status: STALE_BUILD_STATUS, headers: { [BUILD_HEADER]: serverBuild ?? "" } }
  );
}
