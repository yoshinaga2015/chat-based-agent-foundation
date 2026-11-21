import type { ReactNode } from "react";

/** GenUI スロットの input-available 相当。活動ストリップと併用。 */
export function UiSurfacePending(props: { label?: string }): ReactNode {
  return (
    <div className="p-0.5" aria-busy="true" aria-label={props.label ?? "面を準備しています"}>
      <div className="flex min-h-36 flex-col gap-3 rounded-lg bg-kumo-recessed p-4">
        <div className="fudo-status-shimmer h-3 w-1/3 rounded bg-kumo-line/60" />
        <div className="fudo-status-shimmer h-24 w-full rounded bg-kumo-line/40" />
        <div className="fudo-status-shimmer h-3 w-1/2 rounded bg-kumo-line/50" />
      </div>
    </div>
  );
}

/** output-error 相当。再送はチャット側。 */
export function UiSurfaceError(props: { message?: string }): ReactNode {
  return (
    <div className="p-0.5" role="alert">
      <div className="rounded-lg px-3 py-2 ring ring-kumo-line">
        <p className="m-0 text-sm text-kumo-default">{props.message ?? "面を出せませんでした"}</p>
      </div>
    </div>
  );
}
