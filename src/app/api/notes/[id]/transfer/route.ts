import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { assertSameOrigin, requireVaultSession } from "@/lib/auth";
import { db, setUserContext } from "@/lib/db";
import { decryptText, encryptText } from "@/lib/crypto";
import { cloneEncryptedNoteAsset } from "@/lib/storage";
import { collectNoteAssetIds, parseNoteAssetId } from "@/lib/asset-references";
import { apiError, readJsonObject, stringField } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };
type AssetRow = {
  id: string;
  storage_key: string | null;
  encrypted_bytes: Buffer | null;
  original_name_enc: Buffer;
  mime_type: string;
  byte_size: string | number;
};

function collectImageAssetIds(value: unknown): Set<string> {
  return collectNoteAssetIds(value);
}
function replaceImageAssetIds(value: unknown, replacements: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => replaceImageAssetIds(item, replacements));
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (record.type === "image" && key === "attrs" && child && typeof child === "object") {
      const attrs = { ...(child as Record<string, unknown>) };
      const src = attrs.src;
      if (typeof src === "string") {
        const assetId = parseNoteAssetId(src);
        if (assetId && replacements.has(assetId)) attrs.src = `/api/assets/${replacements.get(assetId)}`;
      }
      next[key] = attrs;
    } else {
      next[key] = replaceImageAssetIds(child, replacements);
    }
  }
  return next;
}

export async function POST(request: Request, context: Context) {
  let client: PoolClient | undefined;
  let commitAttempted = false;
  let newNoteId: string | undefined;
  try {
    assertSameOrigin(request);
    const session = await requireVaultSession();
    const { id } = await context.params;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(id)) throw new Error("NOT_FOUND");
    const body = await readJsonObject(request, 16 * 1024);
    const action = stringField(body, "action", 10, true);
    const destinationTopicId = stringField(body, "topicId", 64, true);
    if (!uuidPattern.test(destinationTopicId)) throw new Error("VALIDATION:Choose a valid destination topic.");
    if (action !== "move" && action !== "copy") throw new Error("VALIDATION:Choose whether to move or copy this note.");

    client = await db.connect();
    await client.query("BEGIN");
    await setUserContext(client, session.userId);
    const sourceResult = await client.query(
      "SELECT topic_id, title_enc, subject_enc, content_enc, tags_enc, pinned FROM notes WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
      [id],
    );
    const source = sourceResult.rows[0];
    if (!source) throw new Error("NOT_FOUND");

    const destinationResult = await client.query("SELECT id FROM topics WHERE id=$1", [destinationTopicId]);
    if (!destinationResult.rows[0]) throw new Error("VALIDATION:Choose a valid destination topic.");

    if (action === "move") {
      if (source.topic_id === destinationTopicId) throw new Error("VALIDATION:This note already belongs to that topic.");
      await client.query(
        "UPDATE notes SET topic_id=$1, updated_at=NOW() WHERE id=$2",
        [destinationTopicId, id],
      );
      await client.query("UPDATE topics SET updated_at=NOW() WHERE id=ANY($1::uuid[])", [[source.topic_id, destinationTopicId]]);
      commitAttempted = true;
      await client.query("COMMIT");
      return NextResponse.json({ success: true, action, noteId: id, topicId: destinationTopicId });
    }

    const sourceContent = JSON.parse(decryptText(source.content_enc, session.key)) as unknown;
    const sourceAssetIds = [...collectImageAssetIds(sourceContent)];
    newNoteId = randomUUID();
    const assetMap = new Map<string, string>();

    if (sourceAssetIds.length > 0) {
      const assetsResult = await client.query(
        `SELECT a.id, a.storage_key, a.original_name_enc, a.mime_type, a.byte_size,
                b.encrypted_bytes
         FROM assets a
         LEFT JOIN asset_blobs b ON b.asset_id = a.id
         WHERE a.owner_type = 'note' AND a.owner_id = $1 AND a.id = ANY($2::uuid[])
         FOR SHARE OF a`,
        [id, sourceAssetIds],
      );
      const assets = assetsResult.rows as AssetRow[];
      if (assets.length !== sourceAssetIds.length) {
        throw new Error("VALIDATION:An image attached to this note is unavailable, so the note cannot be copied safely.");
      }
      for (const asset of assets) {
        const cloned = await cloneEncryptedNoteAsset({
          asset,
          userId: session.userId,
          ownerId: newNoteId,
          key: session.key,
          query: (text, values) => client!.query(text, values),
        });
        assetMap.set(asset.id.toLowerCase(), cloned.id);
      }
    }

    const copiedContent = replaceImageAssetIds(sourceContent, assetMap);
    const copiedContentJson = JSON.stringify(copiedContent);
    if (copiedContentJson.length > 2_000_000) throw new Error("VALIDATION:This note is too large to copy.");

    await client.query(
      `INSERT INTO notes (id, topic_id, title_enc, subject_enc, content_enc, tags_enc, pinned, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())`,
      [
        newNoteId,
        destinationTopicId,
        encryptText(decryptText(source.title_enc, session.key), session.key),
        encryptText(decryptText(source.subject_enc, session.key), session.key),
        encryptText(copiedContentJson, session.key),
        encryptText(decryptText(source.tags_enc, session.key), session.key),
        source.pinned,
      ],
    );
    await client.query("UPDATE topics SET updated_at=NOW() WHERE id=$1", [destinationTopicId]);
    commitAttempted = true;
    await client.query("COMMIT");
    return NextResponse.json({ success: true, action, noteId: newNoteId, topicId: destinationTopicId }, { status: 201 });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    if (commitAttempted) {
      console.error("[Mnemosyne] Note transfer commit outcome is uncertain; copied note, asset metadata and encrypted blobs share one database transaction.", {
        noteId: newNoteId,
      });
    }
    return apiError(error);
  } finally {
    client?.release();
  }
}
