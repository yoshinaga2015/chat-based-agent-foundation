// 対話モデルの識別子と AI バインディング。スキルやツール実装には書かない。

/** Worker の env.AI を gateway "default" 付きで包んだもの。api がリクエストごとに入れる。 */
export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
  websearch(request: { query: string; provider?: string; limit?: number }): Promise<Response>;
}

export interface ChatConfig {
  model: string;
  ai: AiBinding;
}

/** AGENT_CHAT_MODEL 未設定時の既定。無料枠の候補で唯一、画像も同じモデルで読める。 */
export const DEFAULT_CHAT_MODEL = "@cf/google/gemma-4-26b-a4b-it";

export interface ChatModelChoice {
  id: string;
  label: string;
  /** 添付画像を同じモデルで読めるか。 */
  images: boolean;
  /** free_allocation: Workers AI の無料枠で動く。gateway: クレジットか AI Gateway に保存した自分のキーが要る。 */
  billing: "free_allocation" | "gateway";
}

/** 画面で選べるモデル。評価卓（session の eval:models）で道具の使い方を確かめたものだけ載せる。 */
export const CHAT_MODEL_CHOICES: readonly ChatModelChoice[] = [
  { id: "@cf/google/gemma-4-26b-a4b-it", label: "Gemma 4 26B", images: true, billing: "free_allocation" },
  { id: "@cf/nvidia/nemotron-3-120b-a12b", label: "Nemotron 3 120B", images: false, billing: "free_allocation" },
  { id: "@cf/zai-org/glm-4.7-flash", label: "GLM-4.7 Flash", images: false, billing: "free_allocation" },
  // 道具の使い方は評価卓で通過。Vision は /ai/v1 経由で image パラメータを拒むため false。
  { id: "openai/gpt-6-luna", label: "GPT-6 Luna", images: false, billing: "gateway" }
];

let installed: AiBinding | null = null;

export function installAi(ai: AiBinding | null): void {
  installed = ai;
}

export function installedAi(): AiBinding | null {
  return installed;
}

/** 配備の既定。AGENT_CHAT_MODEL は持ち主が配備で決めるので、一覧の外でも使う。 */
export function deploymentChatModel(env: Readonly<Record<string, string | undefined>>): string {
  return env["AGENT_CHAT_MODEL"]?.trim() || DEFAULT_CHAT_MODEL;
}

/** 画面から保存してよいモデルか。一覧か配備の既定に限る。 */
export function isSelectableChatModel(env: Readonly<Record<string, string | undefined>>, model: string): boolean {
  return model === deploymentChatModel(env) || CHAT_MODEL_CHOICES.some((choice) => choice.id === model);
}

/** スレッドで選んだモデルがあればそれを、なければ配備の既定を使う。 */
export function chatModelFor(env: Readonly<Record<string, string | undefined>>, threadModel?: string | null): string {
  const chosen = threadModel?.trim();
  return chosen && isSelectableChatModel(env, chosen) ? chosen : deploymentChatModel(env);
}

export function loadChatConfig(
  env: Readonly<Record<string, string | undefined>>,
  threadModel?: string | null
): ChatConfig | null {
  if (!installed) return null;
  return { model: chatModelFor(env, threadModel), ai: installed };
}
