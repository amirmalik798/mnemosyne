import { NextResponse } from "next/server";
import { requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { readEncryptedAsset } from "@/lib/storage";
import { apiError } from "@/lib/http";
import { createZipStream, type ZipStreamEntry } from "@/lib/zip-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
type NoteRow = { id: string; title_enc: Buffer; content_enc: Buffer };
type AssetRow = {
  id: string;
  owner_id: string;
  storage_key: string;
  original_name_enc: Buffer;
  byte_size: string | number;
};

const ASSET_URL = /^\/api\/assets\/([a-f0-9-]{36})$/i;

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
    const topicResult = await db.query(
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
    const noteResult = await db.query(
      "SELECT id, title_enc, content_enc FROM notes WHERE topic_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC",
      [id],
    );
    const notes = noteResult.rows as NoteRow[];
    const referencedByNote = new Map<string, Set<string>>();
    const referencedAssetIds = new Set<string>();

    for (const note of notes) {
      const content = JSON.parse(decryptText(note.content_enc, session.key)) as unknown;
      const imageIds = new Set<string>();
      collectImageAssetIds(content, imageIds);
      if (imageIds.size > 0) {
        referencedByNote.set(note.id, imageIds);
        imageIds.forEach((assetId) => referencedAssetIds.add(assetId));
      }
    }

    const noteAssetsResult = referencedAssetIds.size > 0 && notes.length > 0
      ? await db.query(
          "SELECT id, owner_id, storage_key, original_name_enc, byte_size FROM assets " +
          "WHERE owner_type='note' AND id = ANY($1::uuid[]) AND owner_id = ANY($2::uuid[]) ORDER BY created_at ASC",
          [Array.from(referencedAssetIds), notes.map((note) => note.id)],
        )
      : { rows: [] };

    let coverAsset: AssetRow | null = null;
    if (topic.cover_asset_id) {
      const coverResult = await db.query(
        "SELECT id, owner_id, storage_key, original_name_enc, byte_size FROM assets WHERE id=$1 AND owner_type='topic' AND owner_id=$2",
        [topic.cover_asset_id, id],
      );
      coverAsset = (coverResult.rows[0] as AssetRow | undefined) ?? null;
    }

    const noteTitles = new Map(notes.map((note) => [
      note.id,
      decryptText(note.title_enc, session.key),
    ]));
    const noteAssets = (noteAssetsResult.rows as AssetRow[]).filter((asset) =>
      referencedByNote.get(asset.owner_id)?.has(asset.id),
    );

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
        read: () => readEncryptedAsset(coverAsset!.storage_key, session.key),
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
        read: () => readEncryptedAsset(asset.storage_key, session.key),
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
