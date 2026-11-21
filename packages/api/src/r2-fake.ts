/** vitest 用の R2Bucket（メモリ上）。 */
export function memoryBucket(): R2Bucket & { keys(): string[] } {
  const rows = new Map<string, { bytes: ArrayBuffer; customMetadata?: Record<string, string>; uploaded: Date }>();
  const objectOf = (key: string) => {
    const row = rows.get(key)!;
    return {
      key,
      size: row.bytes.byteLength,
      uploaded: row.uploaded,
      customMetadata: row.customMetadata,
      body: new Response(row.bytes).body!,
      arrayBuffer: async () => row.bytes.slice(0),
      text: async () => new TextDecoder().decode(row.bytes)
    };
  };
  let tick = 0;
  return {
    keys: () => [...rows.keys()].sort(),
    async get(key) {
      return rows.has(key) ? objectOf(key) : null;
    },
    async head(key) {
      return rows.has(key) ? objectOf(key) : null;
    },
    async put(key, value, options) {
      const bytes =
        typeof value === "string"
          ? new TextEncoder().encode(value).buffer
          : value instanceof ArrayBuffer
            ? value.slice(0)
            : ArrayBuffer.isView(value)
              ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice().buffer
              : await new Response(value as ReadableStream).arrayBuffer();
      tick += 1;
      rows.set(key, { bytes: bytes as ArrayBuffer, customMetadata: options?.customMetadata, uploaded: new Date(1_000 + tick) });
      return objectOf(key);
    },
    async list(options) {
      const prefix = options?.prefix ?? "";
      const objects = [...rows.keys()].filter((key) => key.startsWith(prefix)).sort().map(objectOf);
      return { objects, truncated: false };
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) rows.delete(key);
    }
  };
}
