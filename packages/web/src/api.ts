import type { ProductView } from "./types";
import { BUILD_HEADER, BUILD_ID, STALE_BUILD_STATUS } from "./build-id";
import { handleStaleBuildResponse } from "./stale-build";

function withBuildHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  if (BUILD_ID) headers.set(BUILD_HEADER, BUILD_ID);
  return headers;
}

async function guardStale(response: Response): Promise<Response> {
  if (response.status !== STALE_BUILD_STATUS) return response;
  handleStaleBuildResponse(response.headers.get(BUILD_HEADER));
  throw new Error("stale_build");
}

export async function getSession(): Promise<ProductView> {
  const response = await fetch("/api/session", { headers: withBuildHeaders() });
  return response.json() as Promise<ProductView>;
}

export async function postJson(path: string, body: unknown = {}): Promise<ProductView> {
  const response = await guardStale(
    await fetch(path, {
      method: "POST",
      headers: withBuildHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(body)
    })
  );
  return response.json() as Promise<ProductView>;
}

export async function startMcpOAuthConnect(body: {
  catalogId?: string;
  name?: string;
  url?: string;
}): Promise<{ authorizeUrl?: string; reason?: string } & Partial<ProductView>> {
  const response = await guardStale(
    await fetch("/api/mcp", {
      method: "POST",
      headers: withBuildHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ op: "oauth_start", ...body })
    })
  );
  return response.json() as Promise<{ authorizeUrl?: string; reason?: string } & Partial<ProductView>>;
}

export interface SpeakAttachPayload {
  name: string;
  media: "image/png" | "image/jpeg" | "application/pdf";
  dataBase64: string;
}

export async function openSpeak(
  text: string,
  attachments: SpeakAttachPayload[] = [],
  init: { signal?: AbortSignal } = {}
): Promise<Response> {
  return guardStale(
    await fetch("/api/speak", {
      method: "POST",
      headers: withBuildHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ text, attachments }),
      signal: init.signal
    })
  );
}

/** 既存 run の delivery log に再接続（リロード復帰）。 */
export async function openSpeakStream(
  runId: string,
  init: { signal?: AbortSignal } = {}
): Promise<Response> {
  return guardStale(
    await fetch(`/api/speak/stream?runId=${encodeURIComponent(runId)}`, {
      headers: withBuildHeaders(),
      signal: init.signal
    })
  );
}

export async function openBrowserHandoffComplete(
  init: { signal?: AbortSignal; outcome?: "done" | "failed"; note?: string } = {}
): Promise<Response> {
  const outcome = init.outcome ?? "done";
  const body: { action: "complete" | "fail"; note?: string } =
    outcome === "failed"
      ? { action: "fail", note: init.note }
      : { action: "complete" };
  return guardStale(
    await fetch("/api/browser-handoff", {
      method: "POST",
      headers: withBuildHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(body),
      signal: init.signal
    })
  );
}

export async function postBrowserHandoffType(text: string): Promise<void> {
  const response = await guardStale(
    await fetch("/api/browser-handoff", {
      method: "POST",
      headers: withBuildHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ action: "type", text })
    })
  );
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { reason?: string };
    const reason = typeof data.reason === "string" ? data.reason : "type_failed";
    throw new Error(reason);
  }
}

export async function fileToSpeakAttach(file: File): Promise<SpeakAttachPayload | null> {
  const media = file.type === "image/png" || file.type === "image/jpeg" || file.type === "application/pdf"
    ? file.type
    : null;
  if (!media) return null;
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return { name: file.name, media, dataBase64: btoa(binary) };
}

export async function readEvents(response: Response, onEvent: (name: string, data: unknown) => void): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const step = await reader.read();
    if (step.done) return;
    buffer += decoder.decode(step.value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      let name = "message";
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event: ")) name = line.slice(7);
        if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (data) onEvent(name, JSON.parse(data) as unknown);
    }
  }
}

export type DocumentView = {
  docId: string;
  name: string;
  media: string;
  version: number;
  bytes: number;
  updatedAt: number;
};

export async function listDocuments(): Promise<DocumentView[]> {
  const response = await guardStale(await fetch("/api/documents", { headers: withBuildHeaders() }));
  if (!response.ok) throw new Error(`documents_${response.status}`);
  return ((await response.json()) as { documents: DocumentView[] }).documents;
}

export async function listDocumentVersions(docId: string): Promise<DocumentView[]> {
  const response = await guardStale(
    await fetch(`/api/documents/${encodeURIComponent(docId)}/versions`, { headers: withBuildHeaders() })
  );
  if (!response.ok) throw new Error(`documents_${response.status}`);
  return ((await response.json()) as { versions: DocumentView[] }).versions;
}

export async function uploadDocument(file: File): Promise<{ ok: true } | { ok: false; reason: string }> {
  const response = await guardStale(
    await fetch("/api/documents", {
      method: "POST",
      headers: withBuildHeaders({
        "x-filename": encodeURIComponent(file.name),
        "content-type": file.type || "application/octet-stream"
      }),
      body: file
    })
  );
  if (response.ok) return { ok: true };
  const body = (await response.json().catch(() => ({}))) as { reason?: string };
  return { ok: false, reason: body.reason ?? `http_${response.status}` };
}

export function documentHref(docId: string, version?: number): string {
  const base = `/api/documents/${encodeURIComponent(docId)}`;
  return version === undefined ? base : `${base}?v=${version}`;
}
