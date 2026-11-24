const NOTE_ASSET_URL_PATTERN = /^\/api\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

/** Parse only the app's own canonical asset URLs; normalize UUID casing for database comparisons. */
export function parseNoteAssetId(src: string): string | null {
  const match = src.match(NOTE_ASSET_URL_PATTERN);
  return match ? match[1].toLowerCase() : null;
}

/** Collect every image asset referenced by a ProseMirror note document. */
export function collectNoteAssetIds(content: unknown): Set<string> {
  const referenced = new Set<string>();
  const pending: unknown[] = [content];

  while (pending.length > 0) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }

    const record = value as Record<string, unknown>;
    if (record.type === "image" && record.attrs && typeof record.attrs === "object") {
      const src = (record.attrs as Record<string, unknown>).src;
      if (typeof src === "string") {
        const assetId = parseNoteAssetId(src);
        if (assetId) referenced.add(assetId);
      }
    }
    pending.push(...Object.values(record));
  }
  return referenced;
}
