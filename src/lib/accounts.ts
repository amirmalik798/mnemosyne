import "server-only";
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import {
  decryptBytes,
  derivePasswordKey,
  encryptBytes,
  hashPassword,
  hashToken,
  verifyPassword,
} from "@/lib/crypto";

export type AccountQuery = (
  text: string,
  values?: unknown[],
) => Promise<{ rows: any[] }>;

export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error("VALIDATION:Enter a valid email address.");
  }
  return email;
}

export async function verifyAccountPassword(
  query: AccountQuery,
  user: {
    id: string;
    password_hash: string | null;
    password_salt: Buffer;
    wrapped_key: Buffer;
  },
  password: string,
): Promise<Buffer | null> {
  if (user.password_hash && !(await verifyPassword(user.password_hash, password))) return null;

  const wrappingKey = await derivePasswordKey(password, user.password_salt);
  try {
    const vaultKey = decryptBytes(user.wrapped_key, wrappingKey);
    // Existing single-user installations had no separate Argon2 verifier.
    // Upgrade that account in place after its original key successfully opens.
    if (!user.password_hash) {
      const passwordHash = await hashPassword(password);
      await query(
        "UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2 AND password_hash IS NULL",
        [passwordHash, user.id],
      );
    }
    return vaultKey;
  } catch {
    return null;
  } finally {
    wrappingKey.fill(0);
  }
}

export async function issueEmailVerificationToken(
  query: AccountQuery,
  userId: string,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await query("DELETE FROM email_verification_tokens WHERE user_id=$1", [userId]);
  await query(
    "INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,NOW() + INTERVAL '24 hours')",
    [userId, hashToken(token)],
  );
  return token;
}

export function queryWithClient(client: PoolClient): AccountQuery {
  return (text, values = []) => client.query(text, values);
}
