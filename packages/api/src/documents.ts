/**
 * 書類の置き場（R2）。保存のたびに新しい版を足し、既存の版は上書きしない。
 * キー: docs/{userId}/{docId}/v{n}。名前と種類は customMetadata に持つ。
 */

export const MAX_DOC_BYTES = 20 * 1024 * 1024;
const NAME_MAX = 120;

export type DocumentRef = {
  docId: string;
  name: string;
  media: string;
  version: number;
  bytes: number;
  updatedAt: number;
};

export type DocumentFail = { ok: false; status: 400 | 404 | 413; reason: string };

export function documentKey(userId: string, docId: string, version: number): string {
  return `docs/${userId}/${docId}/v${version}`;
}

/** ファイル名として安全な名前だけを通す（パス区切り・制御文字・先頭ドットは不可）。 */
export function safeDocName(raw: string): string | null {
  const name = raw.normalize("NFC").trim();
  if (!name || name.length > NAME_MAX) return null;
  if (name.startsWith(".") || /[\/\\\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

function refOf(object: R2Object): DocumentRef | null {
  const match = /^docs\/[^/]+\/([^/]+)\/v(\d+)$/.exec(object.key);
  const name = object.customMetadata?.name;
  if (!match || !name) return null;
  return {
    docId: match[1]!,
    name,
    media: object.customMetadata?.media ?? "application/octet-stream",
    version: Number(match[2]),
    bytes: object.size,
    updatedAt: object.uploaded.getTime()
  };
}

async function listAll(bucket: R2Bucket, prefix: string): Promise<R2Object[]> {
  const rows: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, include: ["customMetadata"] });
    rows.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return rows;
}

export async function listVersions(bucket: R2Bucket, userId: string, docId: string): Promise<DocumentRef[]> {
  const rows = await listAll(bucket, `docs/${userId}/${docId}/`);
  return rows.flatMap((row) => refOf(row) ?? []).sort((a, b) => a.version - b.version);
}

/** 書類ごとの最新版。 */
export async function listDocuments(bucket: R2Bucket, userId: string): Promise<DocumentRef[]> {
  const latest = new Map<string, DocumentRef>();
  for (const row of await listAll(bucket, `docs/${userId}/`)) {
    const ref = refOf(row);
    if (!ref) continue;
    const seen = latest.get(ref.docId);
    if (!seen || seen.version < ref.version) latest.set(ref.docId, ref);
  }
  return [...latest.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function readDocument(
  bucket: R2Bucket,
  userId: string,
  docId: string,
  version?: number
): Promise<{ ref: DocumentRef; bytes: ArrayBuffer } | null> {
  const target = version ?? (await listVersions(bucket, userId, docId)).at(-1)?.version;
  if (target === undefined) return null;
  const object = await bucket.get(documentKey(userId, docId, target));
  if (!object) return null;
  const ref = refOf(object);
  if (!ref) return null;
  return { ref, bytes: await object.arrayBuffer() };
}

export async function createDocument(
  bucket: R2Bucket,
  userId: string,
  input: { name: string; media: string; bytes: ArrayBuffer }
): Promise<{ ok: true; ref: DocumentRef } | DocumentFail> {
  const name = safeDocName(input.name);
  if (!name) return { ok: false, status: 400, reason: "invalid_name" };
  if (input.bytes.byteLength > MAX_DOC_BYTES) return { ok: false, status: 413, reason: "too_large" };
  const docId = crypto.randomUUID();
  return { ok: true, ref: await putVersion(bucket, userId, docId, 1, name, input.media, input.bytes) };
}

/** 既存の書類に新しい版を足す。名前と種類は直前の版を引き継ぐ。 */
export async function addVersion(
  bucket: R2Bucket,
  userId: string,
  docId: string,
  bytes: ArrayBuffer
): Promise<{ ok: true; ref: DocumentRef } | DocumentFail> {
  if (bytes.byteLength > MAX_DOC_BYTES) return { ok: false, status: 413, reason: "too_large" };
  const previous = (await listVersions(bucket, userId, docId)).at(-1);
  if (!previous) return { ok: false, status: 404, reason: "document_not_found" };
  return {
    ok: true,
    ref: await putVersion(bucket, userId, docId, previous.version + 1, previous.name, previous.media, bytes)
  };
}

async function putVersion(
  bucket: R2Bucket,
  userId: string,
  docId: string,
  version: number,
  name: string,
  media: string,
  bytes: ArrayBuffer
): Promise<DocumentRef> {
  await bucket.put(documentKey(userId, docId, version), bytes, {
    customMetadata: { name, media },
    httpMetadata: { contentType: media }
  });
  return { docId, name, media, version, bytes: bytes.byteLength, updatedAt: Date.now() };
}
