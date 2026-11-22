import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { lstat, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
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
      "SELECT id, storage_key, byte_size FROM assets ORDER BY storage_key",
    );
    const referencedFiles = new Set<string>();
    const issues: string[] = [];
    let missingFiles = 0;
    let invalidFiles = 0;
    let sizeMismatches = 0;

    for (const row of result.rows) {
      const storageKey = String(row.storage_key);
      const filePath = resolveStorageFilePath(root, storageKey);
      if (!filePath) {
        invalidFiles += 1;
        issues.push("Invalid storage key for asset " + row.id);
        continue;
      }

      referencedFiles.add(storageKey);
      const originalSize = Number(row.byte_size);
      if (
        !Number.isSafeInteger(originalSize) ||
        originalSize <= 0 ||
        originalSize > MAX_IMAGE_BYTES
      ) {
        invalidFiles += 1;
        issues.push("Invalid stored byte_size for asset " + row.id);
        continue;
      }

      let fileInfo;
      try {
        fileInfo = await lstat(filePath);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          missingFiles += 1;
          issues.push("Missing encrypted file: " + storageKey);
          continue;
        }
        throw error;
      }

      if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
        invalidFiles += 1;
        issues.push("Storage entry is not a regular file: " + storageKey);
        continue;
      }

      const expectedEncryptedSize = originalSize + ENCRYPTION_OVERHEAD_BYTES;
      if (fileInfo.size !== expectedEncryptedSize) {
        sizeMismatches += 1;
        issues.push(
          "Encrypted file size mismatch: " + storageKey +
          " (expected " + expectedEncryptedSize + " bytes, found " + fileInfo.size + ")",
        );
      }
    }

    let directoryEntries: Dirent[] = [];
    try {
      directoryEntries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }

    let orphanedFiles = 0;
    let unsafeEntries = 0;
    for (const entry of directoryEntries) {
      if (!entry.name.toLowerCase().endsWith(".enc")) continue;
      if (entry.isSymbolicLink()) {
        unsafeEntries += 1;
      } else if (entry.isFile() && !referencedFiles.has(entry.name)) {
        orphanedFiles += 1;
      }
    }

    console.log("Encrypted storage check completed (read-only).");
    console.log("Database asset records: " + result.rows.length);
    console.log("Missing files: " + missingFiles);
    console.log("Invalid records/files: " + invalidFiles);
    console.log("Encrypted-size mismatches: " + sizeMismatches);
    console.log("Unreferenced encrypted files: " + orphanedFiles + " (not deleted)");
    console.log("Symbolic-link storage entries: " + unsafeEntries);

    for (const issue of issues.slice(0, 25)) console.error("- " + issue);
    if (issues.length > 25) console.error("- Plus " + (issues.length - 25) + " additional issues.");

    if (missingFiles > 0 || invalidFiles > 0 || sizeMismatches > 0 || unsafeEntries > 0) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Storage check failed.");
  process.exit(1);
});
