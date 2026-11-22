import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { assertSameOrigin, requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText, encryptText } from "@/lib/crypto";
import { cloneEncryptedNoteAsset, removeEncryptedStorageFile } from "@/lib/storage";
import { apiError, readJsonObject, stringField } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };
type AssetRow = {
  id: string;
  storage_key: string;
  original_name_enc: Buffer;
  mime_type: string;
  byte_size: string | number;
};

function collectImageAssetIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return ids;
  if (Array.isArray(value)) {
    value.forEach((item) => collectImageAssetIds(item, ids));
    return ids;
  }
  const record = value as Record<string, unknown>;
  if (record.type === "image" && record.attrs && typeof record.attrs === "object") {
    const src = (record.attrs as Record<string, unknown>).src;
    if (typeof src === "string") {
      const match = src.match(/^\/api\/assets\/([a-f0-9-]+)$/i);
      if (match) ids.add(match[1]);
    }
  }
  Object.values(record).forEach((child) => collectImageAssetIds(child, ids));
  return ids;
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
        const match = src.match(/^\/api\/assets\/([a-f0-9-]+)$/i);
        if (match && replacements.has(match[1])) attrs.src = `/api/assets/${replacements.get(match[1])}`;
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
  const createdStorageKeys: string[] = [];
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
      await client.query("COMMIT");
      return NextResponse.json({ success: true, action, noteId: id, topicId: destinationTopicId });
    }

    const sourceContent = JSON.parse(decryptText(source.content_enc, session.key)) as unknown;
    const sourceAssetIds = [...collectImageAssetIds(sourceContent)];
    const newNoteId = randomUUID();
    const assetMap = new Map<string, string>();

    if (sourceAssetIds.length > 0) {
      const assetsResult = await client.query(
        `SELECT id, storage_key, original_name_enc, mime_type, byte_size
         FROM assets WHERE owner_type='note' AND owner_id=$1 AND id=ANY($2::uuid[]) FOR SHARE`,
        [id, sourceAssetIds],
      );
      const assets = assetsResult.rows as AssetRow[];
      if (assets.length !== sourceAssetIds.length) {
        throw new Error("VALIDATION:An image attached to this note is unavailable, so the note cannot be copied safely.");
      }
      for (const asset of assets) {
        const cloned = await cloneEncryptedNoteAsset({
          asset,
          ownerId: newNoteId,
          key: session.key,
          query: (text, values) => client!.query(text, values),
        });
        createdStorageKeys.push(cloned.storageKey);
        assetMap.set(asset.id, cloned.id);
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
    await client.query("COMMIT");
    return NextResponse.json({ success: true, action, noteId: newNoteId, topicId: destinationTopicId }, { status: 201 });
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    await Promise.all(createdStorageKeys.map(removeEncryptedStorageFile));
    return apiError(error);
  } finally {
    client?.release();
  }
}
