import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Pool } from "pg";
import { createDatabasePoolConfig } from "../src/lib/db-config";
import { resolveStorageFilePath } from "../src/lib/storage-path";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ENCRYPTION_OVERHEAD_BYTES = 12 + 16;
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const root = resolve(process.env.STORAGE_DIR || join(process.cwd(), "storage"));
  const pool = new Pool(createDatabasePoolConfig(process.env, { max: 2 }));

  try {
    const pending = await pool.query(
      `SELECT id, storage_key, byte_size
       FROM assets
       WHERE storage_key IS NOT NULL
       ORDER BY created_at, id`,
    );

    console.log(
      (dryRun ? "Dry run: inspecting " : "Preparing to migrate ") +
      pending.rows.length +
      " legacy image file(s) into PostgreSQL.",
    );

    let processed = 0;
    let skippedDeleted = 0;

    for (const row of pending.rows) {
      const assetId = String(row.id);
      const storageKey = String(row.storage_key);
      const byteSize = Number(row.byte_size);
      if (!Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > MAX_IMAGE_BYTES) {
        throw new Error("Invalid byte_size metadata for asset " + assetId + ".");
      }

      const filePath = resolveStorageFilePath(root, storageKey);
      if (!filePath) {
        throw new Error("Refusing an invalid legacy storage path for asset " + assetId + ".");
      }

      const fileInfo = await lstat(filePath);
      if (fileInfo.isSymbolicLink() || !fileInfo.isFile()) {
        throw new Error("Legacy asset is not a regular file: " + storageKey);
      }

      const encryptedBytes = await readFile(filePath);
      const expectedEncryptedSize = byteSize + ENCRYPTION_OVERHEAD_BYTES;
      if (
        encryptedBytes.byteLength !== expectedEncryptedSize ||
        fileInfo.size !== expectedEncryptedSize
      ) {
        throw new Error(
          "Legacy encrypted image size mismatch for asset " + assetId +
          " (expected " + expectedEncryptedSize + " bytes, found " + encryptedBytes.byteLength + ").",
        );
      }

      if (dryRun) {
        processed += 1;
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query(
          "SELECT storage_key, byte_size FROM assets WHERE id = $1 FOR UPDATE",
          [assetId],
        );

        if (!current.rows[0]) {
          await client.query("ROLLBACK");
          skippedDeleted += 1;
          continue;
        }

        if (current.rows[0].storage_key === null) {
          await client.query("ROLLBACK");
          continue;
        }

        if (
          current.rows[0].storage_key !== storageKey ||
          Number(current.rows[0].byte_size) !== byteSize
        ) {
          throw new Error("Asset metadata changed during migration for asset " + assetId + ".");
        }

        const existingBlob = await client.query(
          "SELECT encrypted_bytes FROM asset_blobs WHERE asset_id = $1",
          [assetId],
        );
        if (existingBlob.rows[0]) {
          const storedBytes = Buffer.from(existingBlob.rows[0].encrypted_bytes as Buffer);
          if (!storedBytes.equals(encryptedBytes)) {
            throw new Error("An existing database blob does not match the legacy file for asset " + assetId + ".");
          }
        } else {
          await client.query(
            "INSERT INTO asset_blobs (asset_id, encrypted_bytes) VALUES ($1, $2)",
            [assetId, encryptedBytes],
          );
        }

        const updated = await client.query(
          "UPDATE assets SET storage_key = NULL WHERE id = $1 AND storage_key = $2 RETURNING id",
          [assetId, storageKey],
        );
        if (!updated.rows[0]) {
          throw new Error("Could not finalize the legacy asset migration for asset " + assetId + ".");
        }

        await client.query("COMMIT");
        processed += 1;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }

    if (dryRun) {
      console.log("Dry run complete. " + processed + " legacy file(s) passed path and size checks; no database rows or files were changed.");
      return;
    }

    const integrity = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE b.asset_id IS NULL)::int AS missing_blobs,
         COUNT(*) FILTER (WHERE a.storage_key IS NOT NULL)::int AS legacy_keys
       FROM assets a
       LEFT JOIN asset_blobs b ON b.asset_id = a.id`,
    );
    const missingBlobs = Number(integrity.rows[0]?.missing_blobs ?? 0);
    const legacyKeys = Number(integrity.rows[0]?.legacy_keys ?? 0);

    console.log("Migrated legacy files: " + processed);
    console.log("Skipped assets deleted during migration: " + skippedDeleted);
    console.log("Assets missing database blobs: " + missingBlobs);
    console.log("Legacy storage references remaining: " + legacyKeys);
    console.log("Original .enc files were not deleted.");

    if (missingBlobs > 0 || legacyKeys > 0) {
      throw new Error("Image migration is incomplete. Stop application writes and rerun npm run assets:migrate-to-db.");
    }

    console.log("All image assets are now stored in PostgreSQL.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Image migration failed.");
  process.exit(1);
});
