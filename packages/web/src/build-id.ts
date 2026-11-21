/** 画面側のビルド版（段J）。api の build-id と同じ規則。 */

declare const __FUDO_BUILD_ID__: string | undefined;

export const BUILD_HEADER = "x-fudo-build";
export const STALE_BUILD_STATUS = 412;

export const BUILD_ID: string | null =
  typeof __FUDO_BUILD_ID__ === "string" && __FUDO_BUILD_ID__.trim()
    ? __FUDO_BUILD_ID__.trim()
    : null;

export function isStaleBuild(serverBuild: string | null, clientBuild: string | null): boolean {
  if (serverBuild === null) return false;
  return clientBuild !== serverBuild;
}
