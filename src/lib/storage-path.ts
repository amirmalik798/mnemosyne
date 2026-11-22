import { resolve, sep } from "node:path";

const ENCRYPTED_ASSET_STORAGE_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.enc$/i;

/** Accept only generated UUID-based encrypted asset filenames. */
export function isValidEncryptedAssetStorageKey(storageKey: string): boolean {
  return ENCRYPTED_ASSET_STORAGE_KEY_PATTERN.test(storageKey);
}

/**
 * Resolve an encrypted asset only when its key is a valid generated filename
 * and the result stays directly inside the configured storage directory.
 */
export function resolveStorageFilePath(rootDirectory: string, storageKey: string): string | null {
  if (!isValidEncryptedAssetStorageKey(storageKey)) return null;

  const root = resolve(rootDirectory);
  const filePath = resolve(root, storageKey);
  const rootPrefix = root.endsWith(sep) ? root : root + sep;
  return filePath.startsWith(rootPrefix) ? filePath : null;
}
