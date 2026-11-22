import { NextResponse } from "next/server";
import { requireVaultSession } from "@/lib/auth";
import { queryAsUser } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { readVerifiedImageAsset } from "@/lib/storage";
import { apiError } from "@/lib/http";
import { createZipStream, type ZipStreamEntry } from "@/lib/zip-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
type AssetRow = {
  id: string;
  storage_key: string | null;
  original_name_enc: Buffer;
  mime_type: string;
  byte_size: string | number;
};

const ASSET_URL = /^\/api\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function collectImageAssetIds(value: unknown, result: Set<string>) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectImageAssetIds(item, result));
    return;
  }

  const record = value as Record<string, unknown>;
  if (record.type === "image" && record.attrs && typeof record.attrs === "object") {
    const src = (record.attrs as Record<string, unknown>).src;
    if (typeof src === "string") {
      const match = src.match(ASSET_URL);
      if (match) result.add(match[1]);
    }
  }
  Object.values(record).forEach((item) => collectImageAssetIds(item, result));
}

function safeZipSegment(value: string, fallback: string): string {
  const safe = value
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/^\.+|\.+$/g, "")
    .trim()
    .slice(0, 100);
  return safe || fallback;
}

export async function GET(_request: Request, context: Context) {
  try {
    const session = await requireVaultSession();
    const { id } = await context.params;
    const noteResult = await queryAsUser(session.userId, 
      "SELECT id, title_enc, content_enc FROM notes WHERE id=$1 AND deleted_at IS NULL",
      [id],
    );
    if (!noteResult.rows[0]) throw new Error("NOT_FOUND");

    const note = noteResult.rows[0] as {
      id: string;
      title_enc: Buffer;
      content_enc: Buffer;
    };
    const noteTitle = decryptText(note.title_enc, session.key);
    const content = JSON.parse(decryptText(note.content_enc, session.key)) as unknown;
    const referencedAssetIds = new Set<string>();
    collectImageAssetIds(content, referencedAssetIds);

    if (referencedAssetIds.size === 0) {
      throw new Error("VALIDATION:This note does not contain any downloadable images.");
    }

    const assetResult = await queryAsUser(session.userId, 
      "SELECT a.id, a.storage_key, a.original_name_enc, a.mime_type, a.byte_size FROM assets a " +
      "WHERE owner_type='note' AND owner_id=$1 AND id=ANY($2::uuid[]) ORDER BY created_at ASC",
      [id, Array.from(referencedAssetIds)],
    );
    const assets = assetResult.rows as AssetRow[];
    if (assets.length !== referencedAssetIds.size) {
      throw new Error("VALIDATION:One or more images attached to this note are unavailable. The complete archive was not exported.");
    }

    const noteFolder = safeZipSegment(noteTitle, "Note");
    const entries: ZipStreamEntry[] = [];
    let totalBytes = 0;

    assets.forEach((asset, index) => {
      const originalName = decryptText(asset.original_name_enc, session.key);
      const filename = safeZipSegment(originalName, "image");
      totalBytes += Number(asset.byte_size);
      entries.push({
        name: noteFolder + "/" + String(index + 1).padStart(2, "0") + "-" + filename,
        read: async () => {
          // Fetch ciphertext only when the ZIP stream reaches this image.
          // This keeps memory use bounded to one image instead of the whole archive.
          const blobResult = await queryAsUser(
            session.userId,
            "SELECT encrypted_bytes FROM asset_blobs WHERE asset_id=$1",
            [asset.id],
          );
          return readVerifiedImageAsset({
            encryptedBytes: (blobResult.rows[0]?.encrypted_bytes as Buffer | undefined) ?? null,
            storageKey: asset.storage_key,
            key: session.key,
            mimeType: asset.mime_type,
            byteSize: asset.byte_size,
          });
        },
      });
    });

    if (!Number.isSafeInteger(totalBytes) || totalBytes > 0xffffffff - 32 * 1024 * 1024) {
      throw new Error("VALIDATION:This note's images are too large for a single ZIP download.");
    }

    const filename = noteFolder + "-images.zip";
    const fallbackFilename = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    const stream = createZipStream(entries);
    return new NextResponse(stream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="' + fallbackFilename + '"; filename*=UTF-8\'\'' + encodeURIComponent(filename),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
