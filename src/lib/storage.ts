import "server-only";
import { chmod, lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { decryptBytes, decryptText, encryptBytes, encryptText } from "@/lib/crypto";
import { db } from "@/lib/db";
import { resolveStorageFilePath } from "@/lib/storage-path";

function storageRoot(): string {
  return resolve(process.env.STORAGE_DIR || join(process.cwd(), "storage"));
}

function safeStoragePath(storageKey: string): string | null {
  return resolveStorageFilePath(storageRoot(), storageKey);
}

async function ensurePrivateStorageRoot(root: string): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  // File mode 0600 and directory mode 0700 prevent other local OS users from
  // reading encrypted assets or enumerating the vault's attachment metadata.
  if (process.platform !== "win32") await chmod(root, 0o700);
}

/**
 * Create an encrypted file without overwriting an existing file. Sync the
 * file before its database row is written so a successful insert never points
 * at an intentionally buffered, unfinished write.
 */
async function writeEncryptedFileExclusive(filePath: string, bytes: Buffer): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let created = false;
  try {
    handle = await open(filePath, "wx", 0o600);
    created = true;
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (created) await unlink(filePath).catch(() => undefined);
    throw error;
  }
}

async function removeStorageFiles(storageKeys: string[]): Promise<void> {
  await Promise.all(storageKeys.map(async (storageKey) => {
    const filePath = safeStoragePath(storageKey);
    if (!filePath) {
      console.error("[Mnemosyne] Refusing to remove an invalid encrypted storage key.", {
        storageKey,
      });
      return;
    }
    try {
      await unlink(filePath);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "UNKNOWN";
      if (code !== "ENOENT") {
        console.error("[Mnemosyne] Encrypted asset cleanup is pending.", {
          storageKey,
          code,
        });
      }
    }
  }));
}

async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    committed = true;
    return result;
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined);
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

export async function saveEncryptedAsset(input: {
  bytes: Buffer;
  name: string;
  mimeType: string;
  ownerType: "topic" | "note";
  ownerId: string;
  key: Buffer;
  query?: (text: string, values?: (string | number | Buffer | null)[]) => Promise<{ rows: unknown[] }>;
}): Promise<{ id: string; mimeType: string; byteSize: number; storageKey: string }> {
  // Store only the original supported image bytes. Never resize, transcode or
  // recompress images in the persistence layer.
  const detectedMime = detectImageMime(input.bytes);
  if (!detectedMime || detectedMime !== input.mimeType) {
    throw new Error("VALIDATION:The image format does not match its file contents.");
  }
  const id = randomUUID();
  const storageKey = `${id}.enc`;
  const root = storageRoot();
  await ensurePrivateStorageRoot(root);
  const filePath = join(root, storageKey);
  await writeEncryptedFileExclusive(filePath, encryptBytes(input.bytes, input.key));
  try {
    const insert: NonNullable<typeof input.query> =
      input.query ?? ((text, values) => db.query(text, values));
    await insert(
      `INSERT INTO assets (id, owner_type, owner_id, storage_key, original_name_enc, mime_type, byte_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, input.ownerType, input.ownerId, storageKey, encryptText(input.name, input.key), input.mimeType, input.bytes.byteLength],
    );
  } catch (error) {
    if (input.query) {
      await unlink(filePath).catch(() => undefined);
    } else {
      console.error("[Mnemosyne] Asset metadata insert failed; encrypted file retained for integrity review.", {
        assetId: id,
        storageKey,
      });
    }
    throw error;
  }
  return { id, mimeType: input.mimeType, byteSize: input.bytes.byteLength, storageKey };
}

export async function readEncryptedAsset(storageKey: string, key: Buffer): Promise<Buffer> {
  const filePath = safeStoragePath(storageKey);
  if (!filePath) throw new Error("Invalid storage key or path.");
  await ensurePrivateStorageRoot(storageRoot());

  const fileInfo = await lstat(filePath);
  if (fileInfo.isSymbolicLink() || !fileInfo.isFile() || fileInfo.size > 20 * 1024 * 1024 + 28) {
    throw new Error("Stored image file is invalid or exceeds the upload limit.");
  }
  return decryptBytes(await readFile(filePath), key);
}

/**
 * Read an image only when its decrypted bytes still match the original upload
 * metadata. AES-GCM authenticates the encrypted file; these checks additionally
 * detect truncation or mismatched MIME/size metadata before serving or exporting.
 */
export async function readVerifiedImageAsset(input: {
  storageKey: string;
  key: Buffer;
  mimeType: string;
  byteSize: string | number;
}): Promise<Buffer> {
  const expectedSize = Number(input.byteSize);
  if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0 || expectedSize > 20 * 1024 * 1024) {
    throw new Error("IMAGE_INTEGRITY:Stored image size is invalid or exceeds the upload limit.");
  }
  const bytes = await readEncryptedAsset(input.storageKey, input.key);
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
  const target = `/api/assets/${assetId}`;
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
      if (src === target) return true;
    }
    pending.push(...Object.values(record));
  }
  return false;
}

export async function deleteAssetById(id: string, key: Buffer): Promise<void> {
  const storageKeys = await withTransaction(async (client) => {
    // Read the owner without taking the asset lock, then lock the parent first.
    // Upload, note deletion and topic-cover operations use this same lock order.
    const owner = await client.query(
      "SELECT owner_type, owner_id FROM assets WHERE id = $1",
      [id],
    );
    if (!owner.rows[0]) return [] as string[];

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
        if (noteContentReferencesAsset(content, id)) {
          throw new Error("ASSET_IN_USE");
        }
      }
    }

    const existing = await client.query(
      "SELECT owner_type, owner_id FROM assets WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (!existing.rows[0]) return [] as string[];

    if (existing.rows[0].owner_type === "topic") {
      await client.query(
        "UPDATE topics SET cover_asset_id = NULL WHERE id = $1 AND cover_asset_id = $2",
        [existing.rows[0].owner_id, id],
      );
    }

    const result = await client.query(
      "DELETE FROM assets WHERE id = $1 RETURNING storage_key",
      [id],
    );
    return result.rows.map((row) => String(row.storage_key));
  });
  await removeStorageFiles(storageKeys);
}

export async function deleteTrashedNoteWithAssets(noteId: string): Promise<void> {
  const storageKeys = await withTransaction(async (client) => {
    const note = await client.query(
      "SELECT id FROM notes WHERE id = $1 AND deleted_at IS NOT NULL FOR UPDATE",
      [noteId],
    );
    if (!note.rows[0]) throw new Error("NOT_FOUND");

    const assets = await client.query(
      "DELETE FROM assets WHERE owner_type = 'note' AND owner_id = $1 RETURNING storage_key",
      [noteId],
    );
    const deleted = await client.query(
      "DELETE FROM notes WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id",
      [noteId],
    );
    if (!deleted.rows[0]) throw new Error("NOT_FOUND");
    return assets.rows.map((row) => String(row.storage_key));
  });
  await removeStorageFiles(storageKeys);
}

export async function deleteEmptyTopicWithAssets(topicId: string): Promise<void> {
  const storageKeys = await withTransaction(async (client) => {
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
    return assets.rows.map((row) => String(row.storage_key));
  });
  await removeStorageFiles(storageKeys);
}

export async function deleteUnreferencedNoteAssets(noteId: string, content: unknown): Promise<void> {
  const referenced = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const record = value as Record<string, unknown>;
    if (record.type === "image" && record.attrs && typeof record.attrs === "object") {
      const src = (record.attrs as Record<string, unknown>).src;
      if (typeof src === "string") {
        const match = src.match(/^\/api\/assets\/([a-f0-9-]+)$/i);
        if (match) referenced.add(match[1]);
      }
    }
    Object.values(record).forEach(visit);
  };
  visit(content);
  const result = await db.query(
    `DELETE FROM assets
     WHERE owner_type = 'note'
       AND owner_id = $1
       AND id::text <> ALL($2::text[])
     RETURNING storage_key`,
    [noteId, Array.from(referenced)],
  );
  await removeStorageFiles(result.rows.map((row: { storage_key: string }) => String(row.storage_key)));
}

/** Clone an already encrypted asset without exposing its plaintext to the filesystem layer. */
export async function cloneEncryptedNoteAsset(input: {
  asset: {
    storage_key: string;
    original_name_enc: Buffer;
    mime_type: string;
    byte_size: string | number;
  };
  ownerId: string;
  key: Buffer;
  query: (text: string, values?: (string | number | Buffer | null)[]) => Promise<{ rows: unknown[] }>;
}): Promise<{ id: string; storageKey: string }> {
  if (!safeStoragePath(input.asset.storage_key)) throw new Error("Invalid storage key.");

  const id = randomUUID();
  const storageKey = `${id}.enc`;
  const root = storageRoot();
  const sourcePath = safeStoragePath(input.asset.storage_key);
  const targetPath = safeStoragePath(storageKey);
  if (!sourcePath || !targetPath) throw new Error("Invalid storage path.");

  await ensurePrivateStorageRoot(root);
  const plainBytes = await readVerifiedImageAsset({
    storageKey: input.asset.storage_key,
    key: input.key,
    mimeType: input.asset.mime_type,
    byteSize: input.asset.byte_size,
  });
  const freshEncryptedBytes = encryptBytes(plainBytes, input.key);
  await writeEncryptedFileExclusive(targetPath, freshEncryptedBytes);
  try {
    await input.query(
      `INSERT INTO assets (id, owner_type, owner_id, storage_key, original_name_enc, mime_type, byte_size)
       VALUES ($1, 'note', $2, $3, $4, $5, $6)`,
      [id, input.ownerId, storageKey, encryptText(decryptText(input.asset.original_name_enc, input.key), input.key), input.asset.mime_type, input.asset.byte_size],
    );
  } catch (error) {
    await unlink(targetPath).catch(() => undefined);
    throw error;
  }
  return { id, storageKey };
}

export async function removeEncryptedStorageFile(storageKey: string): Promise<void> {
  await removeStorageFiles([storageKey]);
}
