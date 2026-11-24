import "server-only";
import { lstat, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { decryptBytes, decryptText, encryptBytes, encryptText } from "@/lib/crypto";
import { db, setUserContext } from "@/lib/db";
import { resolveStorageFilePath } from "@/lib/storage-path";
import { collectNoteAssetIds } from "@/lib/asset-references";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ENCRYPTION_OVERHEAD_BYTES = 12 + 16;

type QueryExecutor = (
  text: string,
  values?: (string | number | Buffer | null)[],
) => Promise<{ rows: unknown[] }>;

function storageRoot(): string {
  return resolve(process.env.STORAGE_DIR || join(process.cwd(), "storage"));
}

function safeStoragePath(storageKey: string): string | null {
  return resolveStorageFilePath(storageRoot(), storageKey);
}

/** Remove only legacy files left over from the one-time filesystem migration. */
async function removeLegacyStorageFiles(storageKeys: Array<string | null | undefined>): Promise<void> {
  const keys = storageKeys.filter((key): key is string => typeof key === "string" && key.length > 0);
  await Promise.all(keys.map(async (storageKey) => {
    const filePath = safeStoragePath(storageKey);
    if (!filePath) {
      console.error("[Mnemosyne] Refusing to remove an invalid legacy storage key.", { storageKey });
      return;
    }
    try {
      await unlink(filePath);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "UNKNOWN";
      if (code !== "ENOENT") {
        console.error("[Mnemosyne] Legacy image cleanup is pending.", { storageKey, code });
      }
    }
  }));
}

async function withTransaction<T>(userId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await setUserContext(client, userId);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function detectImageMime(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) return "image/gif";
  return null;
}

/**
 * Persist image metadata and ciphertext together. Callers that already own a
 * transaction pass its query executor; standalone callers get an internal
 * transaction so an asset can never be committed without its encrypted blob.
 */
export async function saveEncryptedAsset(input: {
  bytes: Buffer;
  name: string;
  mimeType: string;
  userId: string;
  ownerType: "topic" | "note";
  ownerId: string;
  key: Buffer;
  query?: QueryExecutor;
}): Promise<{ id: string; mimeType: string; byteSize: number }> {
  const detectedMime = detectImageMime(input.bytes);
  if (!detectedMime || detectedMime !== input.mimeType) {
    throw new Error("VALIDATION:The image format does not match its file contents.");
  }
  if (input.bytes.byteLength <= 0 || input.bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("VALIDATION:Images must be 20 MB or smaller.");
  }

  const id = randomUUID();
  const encryptedBytes = encryptBytes(input.bytes, input.key);
  const encryptedName = encryptText(input.name, input.key);

  const persist = async (query: QueryExecutor) => {
    await query(
      `INSERT INTO assets (id, user_id, owner_type, owner_id, storage_key, original_name_enc, mime_type, byte_size)
       VALUES ($1, $2, $3, $4, NULL, $5, $6, $7)`,
      [id, input.userId, input.ownerType, input.ownerId, encryptedName, input.mimeType, input.bytes.byteLength],
    );
    await query(
      "INSERT INTO asset_blobs (asset_id, user_id, encrypted_bytes) VALUES ($1, $2, $3)",
      [id, input.userId, encryptedBytes],
    );
  };

  if (input.query) {
    await persist(input.query);
  } else {
    await withTransaction(input.userId, (client) => persist((text, values) => client.query(text, values)));
  }

  return { id, mimeType: input.mimeType, byteSize: input.bytes.byteLength };
}

/** Read a legacy file only while an installation is being migrated to PostgreSQL blobs. */
async function readLegacyEncryptedAsset(storageKey: string, key: Buffer): Promise<Buffer> {
  const filePath = safeStoragePath(storageKey);
  if (!filePath) throw new Error("Invalid legacy storage key or path.");

  const fileInfo = await lstat(filePath);
  if (
    fileInfo.isSymbolicLink() ||
    !fileInfo.isFile() ||
    fileInfo.size < ENCRYPTION_OVERHEAD_BYTES + 1 ||
    fileInfo.size > MAX_IMAGE_BYTES + ENCRYPTION_OVERHEAD_BYTES
  ) {
    throw new Error("Stored legacy image file is invalid or exceeds the upload limit.");
  }
  return decryptBytes(await readFile(filePath), key);
}

/**
 * Authenticate and verify an encrypted database blob. The legacy file fallback
 * exists only so older assets remain readable between deployment and import.
 */
export async function readVerifiedImageAsset(input: {
  encryptedBytes?: Buffer | null;
  storageKey?: string | null;
  key: Buffer;
  mimeType: string;
  byteSize: string | number;
}): Promise<Buffer> {
  const expectedSize = Number(input.byteSize);
  if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0 || expectedSize > MAX_IMAGE_BYTES) {
    throw new Error("IMAGE_INTEGRITY:Stored image size is invalid or exceeds the upload limit.");
  }

  let bytes: Buffer;
  if (input.encryptedBytes) {
    if (input.encryptedBytes.byteLength !== expectedSize + ENCRYPTION_OVERHEAD_BYTES) {
      throw new Error("IMAGE_INTEGRITY:Encrypted database blob size does not match the original upload.");
    }
    bytes = decryptBytes(input.encryptedBytes, input.key);
  } else if (input.storageKey) {
    bytes = await readLegacyEncryptedAsset(input.storageKey, input.key);
  } else {
    throw new Error("IMAGE_INTEGRITY:Encrypted image blob is missing from the database.");
  }

  if (bytes.byteLength !== expectedSize) {
    throw new Error("IMAGE_INTEGRITY:Stored image size does not match the original upload.");
  }

  const detectedMime = detectImageMime(bytes);
  if (!detectedMime || detectedMime !== input.mimeType) {
    throw new Error("IMAGE_INTEGRITY:Stored image format does not match the original upload.");
  }
  return bytes;
}

function noteContentReferencesAsset(content: unknown, assetId: string): boolean {
  return collectNoteAssetIds(content).has(assetId.toLowerCase());
}

export async function deleteAssetById(id: string, key: Buffer, userId: string): Promise<void> {
  const legacyStorageKeys = await withTransaction(userId, async (client) => {
    const owner = await client.query(
      "SELECT owner_type, owner_id FROM assets WHERE id = $1",
      [id],
    );
    if (!owner.rows[0]) return [] as Array<string | null>;

    if (owner.rows[0].owner_type === "topic") {
      await client.query(
        "SELECT id FROM topics WHERE id = $1 FOR NO KEY UPDATE",
        [owner.rows[0].owner_id],
      );
    } else if (owner.rows[0].owner_type === "note") {
      const note = await client.query(
        "SELECT content_enc FROM notes WHERE id = $1 FOR NO KEY UPDATE",
        [owner.rows[0].owner_id],
      );
      if (note.rows[0]) {
        const content = JSON.parse(decryptText(note.rows[0].content_enc, key));
        if (noteContentReferencesAsset(content, id)) throw new Error("ASSET_IN_USE");
      }
    }

    const existing = await client.query(
      "SELECT owner_type, owner_id FROM assets WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (!existing.rows[0]) return [] as Array<string | null>;

    if (existing.rows[0].owner_type === "topic") {
      await client.query(
        "UPDATE topics SET cover_asset_id = NULL, updated_at = NOW() WHERE id = $1 AND cover_asset_id = $2",
        [existing.rows[0].owner_id, id],
      );
    }

    const result = await client.query(
      "DELETE FROM assets WHERE id = $1 RETURNING storage_key",
      [id],
    );
    return result.rows.map((row) => row.storage_key as string | null);
  });
  await removeLegacyStorageFiles(legacyStorageKeys);
}

export async function deleteTrashedNoteWithAssets(noteId: string, userId: string): Promise<void> {
  const legacyStorageKeys = await withTransaction(userId, async (client) => {
    const note = await client.query(
      "SELECT id, topic_id FROM notes WHERE id = $1 AND deleted_at IS NOT NULL FOR UPDATE",
      [noteId],
    );
    if (!note.rows[0]) throw new Error("NOT_FOUND");

    await client.query("UPDATE topics SET updated_at = NOW() WHERE id = $1", [note.rows[0].topic_id]);

    const assets = await client.query(
      "DELETE FROM assets WHERE owner_type = 'note' AND owner_id = $1 RETURNING storage_key",
      [noteId],
    );
    const deleted = await client.query(
      "DELETE FROM notes WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id",
      [noteId],
    );
    if (!deleted.rows[0]) throw new Error("NOT_FOUND");
    return assets.rows.map((row) => row.storage_key as string | null);
  });
  await removeLegacyStorageFiles(legacyStorageKeys);
}

export async function deleteEmptyTopicWithAssets(topicId: string, userId: string): Promise<void> {
  const legacyStorageKeys = await withTransaction(userId, async (client) => {
    const topic = await client.query(
      "SELECT id FROM topics WHERE id = $1 FOR UPDATE",
      [topicId],
    );
    if (!topic.rows[0]) throw new Error("NOT_FOUND");

    const notes = await client.query(
      "SELECT 1 FROM notes WHERE topic_id = $1 LIMIT 1",
      [topicId],
    );
    if (notes.rows.length > 0) throw new Error("CONFLICT");

    const assets = await client.query(
      "DELETE FROM assets WHERE owner_type = 'topic' AND owner_id = $1 RETURNING storage_key",
      [topicId],
    );
    const deleted = await client.query(
      "DELETE FROM topics WHERE id = $1 RETURNING id",
      [topicId],
    );
    if (!deleted.rows[0]) throw new Error("NOT_FOUND");
    return assets.rows.map((row) => row.storage_key as string | null);
  });
  await removeLegacyStorageFiles(legacyStorageKeys);
}

function collectReferencedNoteAssetIds(content: unknown): Set<string> {
  return collectNoteAssetIds(content);
}
/**
 * Update a note and remove no-longer-referenced images under the same row lock
 * and transaction. This serializes edits with uploads, moves, and asset deletes,
 * preventing one concurrent save from deleting another save's newly referenced
 * image.
 */
export async function updateNoteAndCleanupAssets(input: {
  userId: string;
  noteId: string;
  topicId: string;
  titleEnc: Buffer;
  subjectEnc: Buffer;
  contentEnc: Buffer;
  tagsEnc: Buffer;
  pinned: boolean;
  content: unknown;
}): Promise<void> {
  const referenced = Array.from(collectReferencedNoteAssetIds(input.content));

  const legacyStorageKeys = await withTransaction(input.userId, async (client) => {
    const note = await client.query(
      "SELECT id, topic_id FROM notes WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
      [input.noteId],
    );
    if (!note.rows[0]) throw new Error("NOT_FOUND");

    const topic = await client.query(
      "SELECT id FROM topics WHERE id = $1",
      [input.topicId],
    );
    if (!topic.rows[0]) throw new Error("VALIDATION:Choose a valid topic.");

    if (referenced.length > 0) {
      const ownedAssets = await client.query(
        `SELECT id FROM assets
         WHERE owner_type = 'note' AND owner_id = $1 AND id = ANY($2::uuid[])
         FOR UPDATE`,
        [input.noteId, referenced],
      );
      if (ownedAssets.rows.length !== referenced.length) {
        throw new Error("VALIDATION:An image is missing or is not attached to this note.");
      }
    }

    await client.query(
      `UPDATE notes
       SET topic_id=$1, title_enc=$2, subject_enc=$3, content_enc=$4,
           tags_enc=$5, pinned=$6, updated_at=NOW()
       WHERE id=$7 AND deleted_at IS NULL`,
      [
        input.topicId,
        input.titleEnc,
        input.subjectEnc,
        input.contentEnc,
        input.tagsEnc,
        input.pinned,
        input.noteId,
      ],
    );

    // The canonical note and its recovery snapshot must transition
    // together. A committed note save therefore cannot leave a stale draft.
    await client.query("DELETE FROM note_drafts WHERE note_id = $1", [input.noteId]);

    await client.query(
      "UPDATE topics SET updated_at = NOW() WHERE id = ANY($1::uuid[])",
      [[note.rows[0].topic_id, input.topicId]],
    );

    const removed = await client.query(
      `DELETE FROM assets
       WHERE owner_type = 'note'
         AND owner_id = $1
         AND id::text <> ALL($2::text[])
       RETURNING storage_key`,
      [input.noteId, referenced],
    );
    return removed.rows.map((row) => row.storage_key as string | null);
  });

  // Legacy files are outside PostgreSQL and can only be removed after commit.
  // Their cleanup helper logs non-ENOENT failures without undoing the saved note.
  await removeLegacyStorageFiles(legacyStorageKeys);
}

/** Duplicate an image using a fresh nonce and store its ciphertext in PostgreSQL. */
export async function cloneEncryptedNoteAsset(input: {
  userId: string;
  asset: {
    storage_key: string | null;
    encrypted_bytes: Buffer | null;
    original_name_enc: Buffer;
    mime_type: string;
    byte_size: string | number;
  };
  ownerId: string;
  key: Buffer;
  query: QueryExecutor;
}): Promise<{ id: string }> {
  const plainBytes = await readVerifiedImageAsset({
    encryptedBytes: input.asset.encrypted_bytes,
    storageKey: input.asset.storage_key,
    key: input.key,
    mimeType: input.asset.mime_type,
    byteSize: input.asset.byte_size,
  });

  const id = randomUUID();
  const encryptedBytes = encryptBytes(plainBytes, input.key);
  const encryptedName = encryptText(
    decryptText(input.asset.original_name_enc, input.key),
    input.key,
  );

  await input.query(
    `INSERT INTO assets (id, user_id, owner_type, owner_id, storage_key, original_name_enc, mime_type, byte_size)
     VALUES ($1, $2, 'note', $3, NULL, $4, $5, $6)`,
    [id, input.userId, input.ownerId, encryptedName, input.asset.mime_type, plainBytes.byteLength],
  );
  await input.query(
    "INSERT INTO asset_blobs (asset_id, user_id, encrypted_bytes) VALUES ($1, $2, $3)",
    [id, input.userId, encryptedBytes],
  );

  return { id };
}

/** Remove a legacy filesystem copy after its database row has been safely committed. */
export async function removeEncryptedStorageFile(storageKey: string): Promise<void> {
  await removeLegacyStorageFiles([storageKey]);
}
