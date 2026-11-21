import { DEFAULT_ALLOWED_ORIGINS } from "./constants";

export function allowedOriginsFromEnv(
  env: Readonly<{ FUDO_ALLOWED_ORIGINS?: string }> = {}
): string[] {
  const extra = (env.FUDO_ALLOWED_ORIGINS ?? "")
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...extra])];
}

export function rejectBadOrigin(request: Request, env: Env = {} as Env): Response | null {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return null;
  const origin = request.headers.get("Origin");
  if (!origin) return json(403, { reason: "origin_required" });
  if (origin === new URL(request.url).origin) return null;
  const allowed = allowedOriginsFromEnv(env);
  if (!allowed.includes(origin)) return json(403, { reason: "origin_forbidden" });
  return null;
}

export function corsHeadersFor(
  request: Request,
  env: Readonly<{ FUDO_ALLOWED_ORIGINS?: string }> = {}
): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (!origin) return {};
  if (!allowedOriginsFromEnv(env).includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "content-type, x-consent, x-holding",
    "access-control-allow-methods": "GET, POST, OPTIONS"
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
