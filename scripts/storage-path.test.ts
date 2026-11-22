import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import {
  isValidEncryptedAssetStorageKey,
  resolveStorageFilePath,
} from "../src/lib/storage-path";

const validKey = "123e4567-e89b-12d3-a456-426614174000.enc";

test("accepts UUID-based encrypted asset filenames", () => {
  assert.equal(isValidEncryptedAssetStorageKey(validKey), true);
  assert.equal(resolveStorageFilePath("storage", validKey), resolve("storage", validKey));
});

test("rejects malformed encrypted asset filenames", () => {
  const invalidKeys = [
    "",
    "123e4567-e89b-12d3-a456-426614174000",
    "123e4567-e89b-12d3-a456-426614174000.txt",
    "not-a-uuid.enc",
    "123e4567--e89b-12d3-a456-426614174000.enc",
    "../123e4567-e89b-12d3-a456-426614174000.enc",
    "..\\\\123e4567-e89b-12d3-a456-426614174000.enc",
    "/tmp/123e4567-e89b-12d3-a456-426614174000.enc",
  ];

  for (const key of invalidKeys) {
    assert.equal(isValidEncryptedAssetStorageKey(key), false, key);
    assert.equal(resolveStorageFilePath("storage", key), null, key);
  }
});

test("keeps valid-looking keys inside the configured storage root", () => {
  const root = resolve("private-vault", "storage");
  const resolved = resolveStorageFilePath(root, validKey);

  assert.equal(resolved, resolve(root, validKey));
  assert.ok(resolved?.startsWith(root));
});
