import { WorkerEntrypoint } from "cloudflare:workers";

/**
 * サンドボックスに渡す置き換え用の値。本物のキーは Worker の Secret にだけある。
 * Claude Code はこの値を x-api-key に載せて送り、outbound handler が差し替える。
 */
export const SANDBOX_KEY_PLACEHOLDER = "sk-ant-fudo-sandbox-placeholder";

export const ANTHROPIC_HOST = "api.anthropic.com";

/** 置き換え用の値を持つ api.anthropic.com/v1/* 宛てだけを通し、本物のキーに差し替える。 */
export function injectAnthropicKey(request: Request, key: string | undefined): Request | Response {
  const url = new URL(request.url);
  if (url.hostname !== ANTHROPIC_HOST) return new Response("host_denied", { status: 403 });
  if (!url.pathname.startsWith("/v1/")) return new Response("path_denied", { status: 403 });
  if (request.headers.get("x-api-key") !== SANDBOX_KEY_PLACEHOLDER) {
    return new Response("credential_denied", { status: 403 });
  }
  if (!key) return new Response("agent_key_unset", { status: 503 });
  url.protocol = "https:";
  const forwarded = new Request(url.toString(), request);
  forwarded.headers.set("x-api-key", key);
  forwarded.headers.delete("authorization");
  return forwarded;
}

export class AnthropicEgress extends WorkerEntrypoint {
  async fetch(request: Request): Promise<Response> {
    const forwarded = injectAnthropicKey(request, this.env.ANTHROPIC_API_KEY);
    if (forwarded instanceof Response) return forwarded;
    return fetch(forwarded);
  }
}
