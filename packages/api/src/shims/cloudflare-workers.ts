/** vitest 用。Workers ランタイムの基底クラスを最小限に置き換える。 */
export class DurableObject {
  constructor(
    readonly ctx: unknown,
    readonly env: unknown
  ) {}
}

export class WorkerEntrypoint {
  constructor(
    readonly ctx: unknown,
    readonly env: unknown
  ) {}
}
