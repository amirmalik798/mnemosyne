import { NextResponse } from "next/server";
import { requireVaultSession } from "@/lib/auth";
import { db, queryAsUser } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { readVerifiedImageAsset } from "@/lib/storage";
import { apiError } from "@/lib/http";
import { createZipStream, type ZipStreamEntry } from "@/lib/zip-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
type AssetRow = {
  id: string;
  owner_id: string;
  storage_key: string | null;
  encrypted_bytes: Buffer | null;
  original_name_enc: Buffer;
  mime_type: string;
  byte_size: string | number;
};

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
    const topicResult = await queryAsUser(session.userId, 
      "SELECT id, title_enc, cover_asset_id FROM topics WHERE id=$1",
      [id],
    );
    if (!topicResult.rows[0]) throw new Error("NOT_FOUND");

    const topic = topicResult.rows[0] as {
      id: string;
      title_enc: Buffer;
      cover_asset_id: string | null;
    };
    const topicTitle = decryptText(topic.title_enc, session.key);
    // Note assets are explicitly linked through owner_type + owner_id.
    // Querying this relation avoids decrypting every note document simply
    // to rediscover assets that the database already associates with notes.
    const [noteAssetsResult, noteTitleRows] = await Promise.all([
      queryAsUser(session.userId, 
        `SELECT a.id, a.owner_id, a.storage_key, a.original_name_enc, a.mime_type, a.byte_size, b.encrypted_bytes
         FROM assets a
         LEFT JOIN asset_blobs b ON b.asset_id = a.id
         JOIN notes n ON n.id = a.owner_id
         WHERE a.owner_type='note' AND n.topic_id=$1 AND n.deleted_at IS NULL
         ORDER BY a.created_at ASC`,
        [id],
      ),
      queryAsUser(session.userId, 
        "SELECT id, title_enc FROM notes WHERE topic_id=$1 AND deleted_at IS NULL",
        [id],
      ),
    ]);
    const noteTitles = new Map(noteTitleRows.rows.map((note) => [
      note.id as string,
      decryptText(note.title_enc, session.key),
    ]));
    const noteAssets = noteAssetsResult.rows as AssetRow[];

    let coverAsset: AssetRow | null = null;
    if (topic.cover_asset_id) {
      const coverResult = await queryAsUser(session.userId, 
        "SELECT a.id, a.owner_id, a.storage_key, a.original_name_enc, a.mime_type, a.byte_size, b.encrypted_bytes FROM assets a LEFT JOIN asset_blobs b ON b.asset_id=a.id WHERE a.id=$1 AND a.owner_type='topic' AND a.owner_id=$2",
        [topic.cover_asset_id, id],
      );
      coverAsset = (coverResult.rows[0] as AssetRow | undefined) ?? null;
    }

    const topicFolder = safeZipSegment(topicTitle, "Topic");
    const entries: ZipStreamEntry[] = [];
    let totalBytes = 0;

    if (coverAsset) {
      const filename = safeZipSegment(
        decryptText(coverAsset.original_name_enc, session.key),
        "topic-cover",
      );
      totalBytes += Number(coverAsset.byte_size);
      entries.push({
        name: topicFolder + "/Topic cover/" + filename,
        read: () => readVerifiedImageAsset({
          encryptedBytes: coverAsset!.encrypted_bytes,
          storageKey: coverAsset!.storage_key,
          key: session.key,
          mimeType: coverAsset!.mime_type,
          byteSize: coverAsset!.byte_size,
        }),
      });
    }

    const imageIndexByNote = new Map<string, number>();
    for (const asset of noteAssets) {
      const noteTitle = safeZipSegment(noteTitles.get(asset.owner_id) ?? "Untitled note", "Untitled note");
      const filename = safeZipSegment(
        decryptText(asset.original_name_enc, session.key),
        "image",
      );
      const imageIndex = (imageIndexByNote.get(asset.owner_id) ?? 0) + 1;
      imageIndexByNote.set(asset.owner_id, imageIndex);
      totalBytes += Number(asset.byte_size);
      entries.push({
        name: topicFolder + "/Notes/" + noteTitle + "-" + asset.owner_id.slice(0, 8) + "/" + String(imageIndex).padStart(2, "0") + "-" + filename,
        read: () => readVerifiedImageAsset({
          encryptedBytes: asset.encrypted_bytes,
          storageKey: asset.storage_key,
          key: session.key,
          mimeType: asset.mime_type,
          byteSize: asset.byte_size,
        }),
      });
    }

    if (entries.length === 0) {
      throw new Error("VALIDATION:This topic does not contain any downloadable images.");
    }
    if (!Number.isSafeInteger(totalBytes) || totalBytes > 0xffffffff - 32 * 1024 * 1024) {
      throw new Error("VALIDATION:This topic's images are too large for a single ZIP download.");
    }

    const filename = topicFolder + "-images.zip";
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
