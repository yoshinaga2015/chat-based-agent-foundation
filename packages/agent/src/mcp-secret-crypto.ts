/** MCP 秘密の AES-GCM 保管。キーは FUDO_MCP_SECRET_KEY（base64 または任意文字列）。 */

const PREFIX = "enc:v1:";

export function mcpSecretKeyFromEnv(
  env: Record<string, string | undefined> = envBag()
): string | undefined {
  const raw = env.FUDO_MCP_SECRET_KEY?.trim();
  return raw || undefined;
}

export function isSealedMcpSecret(value: string): boolean {
  return value.startsWith(PREFIX);
}

/**
 * キー必須。平文保管は明示オプトイン `FUDO_MCP_ALLOW_PLAINTEXT=1` のみ（ローカル）。
 */
export async function sealMcpSecret(
  plain: string,
  keyMaterial: string | undefined = mcpSecretKeyFromEnv()
): Promise<string> {
  const trimmed = plain.trim();
  if (!trimmed) return trimmed;
  if (!keyMaterial) {
    if (allowPlaintextMcpSecret()) return trimmed;
    throw new Error("mcp_secret_key_missing");
  }
  if (isSealedMcpSecret(trimmed)) return trimmed;
  const key = await importKey(keyMaterial);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bytesForSubtle(iv) },
    key,
    bytesForSubtle(new TextEncoder().encode(trimmed))
  );
  return `${PREFIX}${base64Url(iv)}:${base64Url(new Uint8Array(cipher))}`;
}

export async function openMcpSecret(
  sealed: string,
  keyMaterial: string | undefined = mcpSecretKeyFromEnv()
): Promise<string> {
  const trimmed = sealed.trim();
  if (!trimmed) return "";
  if (!isSealedMcpSecret(trimmed)) return trimmed;
  if (!keyMaterial) {
    throw new Error("mcp_secret_key_missing");
  }
  const body = trimmed.slice(PREFIX.length);
  const sep = body.indexOf(":");
  if (sep <= 0) throw new Error("mcp_secret_corrupt");
  const iv = fromBase64Url(body.slice(0, sep));
  const data = fromBase64Url(body.slice(sep + 1));
  const key = await importKey(keyMaterial);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytesForSubtle(iv) },
    key,
    bytesForSubtle(data)
  );
  return new TextDecoder().decode(plain);
}

async function importKey(material: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = fromBase64Url(material);
  } catch {
    raw = new TextEncoder().encode(material);
  }
  const digest = await crypto.subtle.digest("SHA-256", bytesForSubtle(raw));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Workers / 古い lib.dom でも subtle に渡せるよう、独立した ArrayBuffer にコピーする。 */
function bytesForSubtle(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function envBag(): Record<string, string | undefined> {
  try {
    return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  } catch {
    return {};
  }
}

function allowPlaintextMcpSecret(): boolean {
  return envBag()["FUDO_MCP_ALLOW_PLAINTEXT"]?.trim() === "1";
}
