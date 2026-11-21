interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
}

interface D1Result<T = unknown> {
  success: boolean;
  meta: Record<string, unknown>;
  results: T[];
}

interface D1ExecResult {
  count: number;
  duration: number;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface DurableObjectId {
  toString(): string;
}

interface DurableObjectStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
  container?: DurableObjectContainer;
  exports: Record<string, (options: { props: Record<string, unknown> }) => Fetcher>;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

interface WorkerAi {
  run(model: string, inputs: Record<string, unknown>, options?: { gateway?: { id: string } }): Promise<unknown>;
  websearch(request: { gatewayId: string; query: string; provider?: string; limit?: number }): Promise<Response>;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface ContainerExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  user?: string;
  signal?: AbortSignal;
  stdin?: ReadableStream | "pipe";
  stdout?: "pipe" | "ignore";
  stderr?: "pipe" | "ignore" | "combined";
}

interface ContainerExecProcess {
  readonly exitCode: Promise<number>;
  output(): Promise<{ stdout: ArrayBuffer; stderr: ArrayBuffer; exitCode: number }>;
  kill(signal?: number): void;
}

interface DurableObjectContainer {
  running: boolean;
  /** コンテナ設定の images。キー → 実イメージ参照。 */
  readonly images?: Record<string, string>;
  start(options: {
    image: string;
    entrypoint?: string[];
    enableInternet?: boolean;
    env?: Record<string, string>;
  }): void | Promise<void>;
  destroy(error?: unknown): Promise<void>;
  exec(argv: string[], options?: ContainerExecOptions): Promise<ContainerExecProcess>;
  interceptOutboundHttps(addr: string, binding: Fetcher): Promise<void>;
}

interface R2Object {
  key: string;
  size: number;
  uploaded: Date;
  customMetadata?: Record<string, string>;
  httpMetadata?: { contentType?: string };
}

interface R2ObjectBody extends R2Object {
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  body: ReadableStream;
}

interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  head(key: string): Promise<R2Object | null>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | ReadableStream,
    options?: { customMetadata?: Record<string, string>; httpMetadata?: { contentType?: string }; onlyIf?: { etagDoesNotMatch?: string } }
  ): Promise<R2Object | null>;
  list(options?: { prefix?: string; cursor?: string; limit?: number; include?: ("customMetadata" | "httpMetadata")[] }): Promise<R2Objects>;
  delete(keys: string | string[]): Promise<void>;
}

interface DurableObjectStorage {
  sql: SqlStorage;
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

interface SqlStorage {
  exec<T = Record<string, SqlStorageValue>>(query: string, ...bindings: SqlStorageValue[]): SqlStorageCursor<T>;
}

type SqlStorageValue = number | string | null | ArrayBuffer;

interface SqlStorageCursor<T> {
  toArray(): T[];
  one(): T;
}

declare namespace Cloudflare {
  interface Env {
    SESSION: DurableObjectNamespace;
    USER_SANDBOX: DurableObjectNamespace;
    DB: D1Database;
    AI: WorkerAi;
    AGENT_CHAT_MODEL?: string;
    CF_ACCESS_TEAM_DOMAIN?: string;
    CF_ACCESS_AUD?: string;
    FUDO_OWNER_EMAIL?: string;
    ASSETS?: Fetcher;
    FUDO_DAILY_TOKEN_CAP?: string;
    FUDO_BUILD_ID?: string;
    FUDO_MCP_HOST_ALLOW?: string;
    FUDO_BROWSER_HOST_ALLOW?: string;
    FUDO_ALLOWED_ORIGINS?: string;
    FUDO_BROWSER_BACKEND?: string;
    FUDO_BROWSER_ACT_URL?: string;
    FUDO_BROWSER_STEEL_FALLBACK_URL?: string;
    FUDO_BROWSER_ACT_TOKEN?: string;
    /** Cloudflare Browser Run binding（一般ブラウザ操作本線） */
    BROWSER?: { fetch: typeof fetch };
    STEEL_API_KEY?: string;
    STEEL_BASE_URL?: string;
    STEEL_USE_PROXY?: string;
    STEEL_PROXY_COUNTRY?: string;
    STEEL_PROXY_URL?: string;
    BROWSER_ACT: DurableObjectNamespace /* BrowserAct */;
    FUDO_CLI_ALLOW?: string;
    FUDO_AGENT_ALLOW?: string;
    /** 持ち主の Anthropic API キー。サンドボックスへは渡さず、outbound handler だけが使う。 */
    ANTHROPIC_API_KEY?: string;
    /** Container が配備に載っているとき "1"。 */
    FUDO_CONTAINERS?: string;
    /** run_agent 1回の上限（USD）。 */
    FUDO_AGENT_MAX_USD?: string;
    /** 書類（原本と版）。 */
    DOCS?: R2Bucket;
    GITHUB_APP_ID?: string;
    GITHUB_APP_PRIVATE_KEY?: string;
    GITHUB_APP_INSTALLATION_ID?: string;
    /** run_agent が触れてよいリポジトリ（owner/name をカンマ区切り）。 */
    FUDO_AGENT_REPOS?: string;
    FUDO_MCP_SECRET_KEY?: string;
    FUDO_MCP_OAUTH_CLIENT_GITHUB?: string;
    FUDO_MCP_OAUTH_SECRET_GITHUB?: string;
    FUDO_MCP_OAUTH_CLIENT_SLACK?: string;
    FUDO_MCP_OAUTH_SECRET_SLACK?: string;
    FUDO_MCP_OAUTH_CLIENT_FIGMA?: string;
    FUDO_MCP_OAUTH_SECRET_FIGMA?: string;
  }
}

interface Env extends Cloudflare.Env {}

declare module "cloudflare:workers" {
  export class DurableObject {
    readonly ctx: DurableObjectState;
    readonly env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
  export class WorkerEntrypoint<Props = Record<string, unknown>> {
    readonly ctx: ExecutionContext & { props: Props };
    readonly env: Env;
    constructor(ctx: ExecutionContext, env: Env);
  }
}

interface ExportedHandler<Env = unknown> {
  fetch?(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
