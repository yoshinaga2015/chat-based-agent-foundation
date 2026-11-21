/**
 * 進行表示の所有者（プロトタイプ #332 / 段I）。
 *
 * fudo の対話経過（考えています…／tool 行）は SSE ターンのクライアント状態。
 * ストリームが `done` なしで終わったらクライアント所有として消す。
 * 将来 DO にサーバー所有の activity を置くときは、接続 id を持ち主にし、
 * 切断時だけ消す（同じ id の再接続が開いていれば消さない）。
 */

export type ProgressKind = "client" | "server";

/** SSE が done を受け取らずに終わったとき、クライアント所有の経過を消す。 */
export function shouldClearClientProgressOnStreamEnd(receivedDone: boolean): boolean {
  return !receivedDone;
}

/**
 * サーバー／画面が書いた activity の接続切断時。
 * server 起点、または持ち主無しは消さない。
 * 切れた接続が持ち主で、同じ id の開いた接続が無ければ消す。
 */
export function shouldClearActivityOnClose(input: {
  kind: ProgressKind;
  ownerConnectionId: string | null;
  closedConnectionId: string;
  openConnectionIds: ReadonlySet<string>;
}): boolean {
  if (input.kind === "server") return false;
  if (input.ownerConnectionId === null) return false;
  if (input.ownerConnectionId !== input.closedConnectionId) return false;
  return !input.openConnectionIds.has(input.ownerConnectionId);
}
