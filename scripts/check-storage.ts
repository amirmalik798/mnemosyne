import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Pool } from "pg";
import { createDatabasePoolConfig } from "../src/lib/db-config";
import { resolveStorageFilePath } from "../src/lib/storage-path";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ENCRYPTION_OVERHEAD_BYTES = 12 + 16;

async function main() {
  const root = resolve(process.env.STORAGE_DIR || join(process.cwd(), "storage"));
  const pool = new Pool(createDatabasePoolConfig(process.env, { max: 1 }));

  try {
    const result = await pool.query(
      `SELECT a.id, a.storage_key, a.byte_size,
              octet_length(b.encrypted_bytes) AS encrypted_size
       FROM assets a
       LEFT JOIN asset_blobs b ON b.asset_id = a.id
       ORDER BY a.id`,
    );

    let missingDatabaseBlobs = 0;
    let invalidRecords = 0;
    let encryptedSizeMismatches = 0;
    let legacyAssetsPending = 0;
    let missingLegacyFiles = 0;
    const issues: string[] = [];

    for (const row of result.rows) {
      const originalSize = Number(row.byte_size);
      if (
        !Number.isSafeInteger(originalSize) ||
        originalSize <= 0 ||
        originalSize > MAX_IMAGE_BYTES
      ) {
        invalidRecords += 1;
        issues.push("Invalid byte_size metadata for asset " + row.id);
        continue;
      }

      const expectedEncryptedSize = originalSize + ENCRYPTION_OVERHEAD_BYTES;
      const encryptedSize = row.encrypted_size === null
        ? null
        : Number(row.encrypted_size);

      if (encryptedSize !== null) {
        if (encryptedSize !== expectedEncryptedSize) {
          encryptedSizeMismatches += 1;
          issues.push(
            "Database blob size mismatch for asset " + row.id +
            " (expected " + expectedEncryptedSize + " bytes, found " + encryptedSize + ")",
          );
        }
        if (row.storage_key !== null) {
          legacyAssetsPending += 1;
          issues.push("Legacy storage reference remains for asset " + row.id);
        }
        continue;
      }

      missingDatabaseBlobs += 1;
      if (typeof row.storage_key !== "string") {
        issues.push("Missing both database blob and legacy storage reference for asset " + row.id);
        continue;
      }

      legacyAssetsPending += 1;
      const filePath = resolveStorageFilePath(root, row.storage_key);
      if (!filePath) {
        invalidRecords += 1;
        issues.push("Invalid legacy storage key for asset " + row.id);
        continue;
      }

      let fileInfo;
      try {
        fileInfo = await lstat(filePath);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          missingLegacyFiles += 1;
          issues.push("Missing legacy encrypted file: " + row.storage_key);
          continue;
        }
        throw error;
      }

      if (fileInfo.isSymbolicLink() || !fileInfo.isFile()) {
        invalidRecords += 1;
        issues.push("Legacy storage entry is not a regular file: " + row.storage_key);
      } else if (fileInfo.size !== expectedEncryptedSize) {
        encryptedSizeMismatches += 1;
        issues.push(
          "Legacy encrypted file size mismatch: " + row.storage_key +
          " (expected " + expectedEncryptedSize + " bytes, found " + fileInfo.size + ")",
        );
      }
    }

    console.log("Encrypted database asset check completed (read-only).");
    console.log("Asset metadata records: " + result.rows.length);
    console.log("Missing database blobs: " + missingDatabaseBlobs);
    console.log("Legacy assets pending import: " + legacyAssetsPending);
    console.log("Missing legacy files: " + missingLegacyFiles);
    console.log("Invalid records/files: " + invalidRecords);
    console.log("Encrypted-size mismatches: " + encryptedSizeMismatches);
    console.log("No files or database records were changed.");

    for (const issue of issues.slice(0, 25)) console.error("- " + issue);
    if (issues.length > 25) console.error("- Plus " + (issues.length - 25) + " additional issues.");

    if (
      missingDatabaseBlobs > 0 ||
      legacyAssetsPending > 0 ||
      missingLegacyFiles > 0 ||
      invalidRecords > 0 ||
      encryptedSizeMismatches > 0
    ) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Encrypted database asset check failed.");
  process.exit(1);
});
