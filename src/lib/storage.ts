import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { decryptBytes, decryptText, encryptBytes, encryptText } from "@/lib/crypto";
import { db } from "@/lib/db";

function storageRoot(): string {
  return resolve(process.env.STORAGE_DIR || join(process.cwd(), "storage"));
}

export function detectImageMime(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) return "image/gif";
  return null;
}

export async function saveEncryptedAsset(input: {
  bytes: Buffer; name: string; mimeType: string; ownerType: "topic" | "note"; ownerId: string; key: Buffer;
}): Promise<{ id: string; mimeType: string; byteSize: number }> {
  const id = randomUUID();
  const storageKey = `${id}.enc`;
  const root = storageRoot();
  await mkdir(root, { recursive: true });
  await writeFile(join(root, storageKey), encryptBytes(input.bytes, input.key), { mode: 0o600 });
  try {
    await db.query(
      `INSERT INTO assets (id, owner_type, owner_id, storage_key, original_name_enc, mime_type, byte_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, input.ownerType, input.ownerId, storageKey, encryptText(input.name, input.key), input.mimeType, input.bytes.byteLength],
    );
  } catch (error) {
    await unlink(join(root, storageKey)).catch(() => undefined);
    throw error;
  }
  return { id, mimeType: input.mimeType, byteSize: input.bytes.byteLength };
}

export async function readEncryptedAsset(storageKey: string, key: Buffer): Promise<Buffer> {
  if (!/^[a-f0-9-]+\.enc$/i.test(storageKey)) throw new Error("Invalid storage key.");
  const filePath = resolve(storageRoot(), storageKey);
  if (!filePath.startsWith(`${storageRoot()}${process.platform === "win32" ? "\\" : "/"}`)) throw new Error("Invalid storage path.");
  return decryptBytes(await readFile(filePath), key);
}

export async function deleteAssetById(id: string): Promise<void> {
  const result = await db.query("DELETE FROM assets WHERE id = $1 RETURNING storage_key", [id]);
  const storageKey = result.rows[0]?.storage_key as string | undefined;
  if (storageKey) await unlink(join(storageRoot(), storageKey)).catch(() => undefined);
}

export async function deleteAssetsFor(ownerType: "topic" | "note", ownerId: string): Promise<void> {
  const result = await db.query(
    "DELETE FROM assets WHERE owner_type = $1 AND owner_id = $2 RETURNING storage_key",
    [ownerType, ownerId],
  );
  await Promise.all(result.rows.map((row: { storage_key: string }) => unlink(join(storageRoot(), row.storage_key)).catch(() => undefined)));
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
  const result = await db.query("SELECT id FROM assets WHERE owner_type='note' AND owner_id=$1", [noteId]);
  for (const row of result.rows) {
    if (!referenced.has(row.id as string)) await deleteAssetById(row.id as string);
  }
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
  if (!/^[a-f0-9-]+\.enc$/i.test(input.asset.storage_key)) throw new Error("Invalid storage key.");

  const id = randomUUID();
  const storageKey = `${id}.enc`;
  const root = storageRoot();
  const sourcePath = resolve(root, input.asset.storage_key);
  const targetPath = resolve(root, storageKey);
  const normalizedRoot = `${root}${process.platform === "win32" ? "\\" : "/"}`;
  if (!sourcePath.startsWith(normalizedRoot) || !targetPath.startsWith(normalizedRoot)) {
    throw new Error("Invalid storage path.");
  }

  await mkdir(root, { recursive: true });
  const encryptedBytes = await readFile(sourcePath);
  const plainBytes = decryptBytes(encryptedBytes, input.key);
  const freshEncryptedBytes = encryptBytes(plainBytes, input.key);
  await writeFile(targetPath, freshEncryptedBytes, { mode: 0o600, flag: "wx" });
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
  if (!/^[a-f0-9-]+\.enc$/i.test(storageKey)) return;
  await unlink(join(storageRoot(), storageKey)).catch(() => undefined);
}
