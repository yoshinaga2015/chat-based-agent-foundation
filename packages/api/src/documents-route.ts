import { MAX_DOC_BYTES, createDocument, listDocuments, listVersions, readDocument } from "./documents";

const DOC_ID = /^[0-9a-f-]{36}$/;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

/**
 * GET  /api/documents                  最新版の一覧
 * POST /api/documents                  新しい書類（x-filename は encodeURIComponent 済み）
 * GET  /api/documents/{docId}/versions 版の一覧
 * GET  /api/documents/{docId}?v=n      本体（v 省略で最新版）
 */
export async function documentsRoute(request: Request, url: URL, env: Env, userId: string): Promise<Response> {
  const bucket = env.DOCS;
  if (!bucket) return json(404, { reason: "docs_unconfigured" });
  const rest = url.pathname.slice("/api/documents".length).split("/").filter(Boolean);

  if (rest.length === 0) {
    if (request.method === "GET") return json(200, { documents: await listDocuments(bucket, userId) });
    if (request.method !== "POST") return json(405, { reason: "method" });
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_DOC_BYTES) return json(413, { reason: "too_large" });
    let name: string;
    try {
      name = decodeURIComponent(request.headers.get("x-filename") ?? "");
    } catch {
      return json(400, { reason: "invalid_name" });
    }
    const media = (request.headers.get("content-type") ?? "application/octet-stream").split(";")[0]!.trim();
    const created = await createDocument(bucket, userId, { name, media, bytes: await request.arrayBuffer() });
    if (!created.ok) return json(created.status, { reason: created.reason });
    return json(201, { document: created.ref });
  }

  const docId = rest[0]!;
  if (request.method !== "GET" || !DOC_ID.test(docId) || rest.length > 2) return json(404, { reason: "not_found" });
  if (rest[1] === "versions") return json(200, { versions: await listVersions(bucket, userId, docId) });
  if (rest.length === 2) return json(404, { reason: "not_found" });
  const raw = url.searchParams.get("v");
  const version = raw === null ? undefined : Number(raw);
  if (version !== undefined && (!Number.isInteger(version) || version < 1)) return json(400, { reason: "invalid_version" });
  const doc = await readDocument(bucket, userId, docId, version);
  if (!doc) return json(404, { reason: "document_not_found" });
  return new Response(doc.bytes, {
    status: 200,
    headers: {
      "content-type": doc.ref.media,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(doc.ref.name)}`
    }
  });
}
