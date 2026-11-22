import "server-only";
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import argon2 from "argon2";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export async function derivePasswordKey(password: string, salt: Buffer): Promise<Buffer> {
  return Buffer.from(await argon2.hash(password, {
    type: argon2.argon2id,
    salt,
    hashLength: KEY_BYTES,
    timeCost: 3,
    memoryCost: 65_536,
    parallelism: 1,
    raw: true,
  }));
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    timeCost: 3,
    memoryCost: 65_536,
    parallelism: 1,
  });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, password, { type: argon2.argon2id });
  } catch {
    return false;
  }
}

export function encryptBytes(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

export function decryptBytes(packed: Buffer, key: Buffer): Buffer {
  if (packed.length < IV_BYTES + TAG_BYTES) throw new Error("Encrypted payload is invalid.");
  const iv = packed.subarray(0, IV_BYTES);
  const tag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const encrypted = packed.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export function encryptText(value: string, key: Buffer): Buffer {
  return encryptBytes(Buffer.from(value, "utf8"), key);
}

export function decryptText(value: Buffer, key: Buffer): string {
  return decryptBytes(value, key).toString("utf8");
}

export function sessionEncryptionKey(): Buffer {
  const secret = process.env.SESSION_ENCRYPTION_SECRET;
  if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) {
    throw new Error("SESSION_ENCRYPTION_SECRET must be a 64-character hexadecimal value.");
  }
  return createHash("sha256").update(Buffer.from(secret, "hex")).digest();
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newVaultKey(): Buffer {
  return randomBytes(KEY_BYTES);
}
