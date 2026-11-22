import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { decryptBytes, encryptBytes, hashToken, sessionEncryptionKey } from "@/lib/crypto";

const COOKIE_NAME = "mnemosyne_session";
const SESSION_HOURS = 12;

export type VaultSession = { id: string; key: Buffer; expiresAt: Date };

export async function isVaultInitialized(): Promise<boolean> {
  const result = await db.query("SELECT 1 FROM vault_settings WHERE id = 1");
  return result.rowCount === 1;
}

export async function createSession(vaultKey: Buffer): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  const encryptedKey = encryptBytes(vaultKey, sessionEncryptionKey());
  await db.query(
    "INSERT INTO vault_sessions (token_hash, encrypted_key, expires_at) VALUES ($1, $2, $3)",
    [hashToken(token), encryptedKey, expiresAt],
  );
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    // Browser-session cookie: closing the browser normally requires the
    // master password again. The server-side session still has a 12-hour cap.
  });
}

export async function getVaultSession(): Promise<VaultSession | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const result = await db.query(
    "SELECT id, encrypted_key, expires_at FROM vault_sessions WHERE token_hash = $1 AND expires_at > NOW() LIMIT 1",
    [hashToken(token)],
  );
  if (!result.rows[0]) return null;
  try {
    return {
      id: result.rows[0].id as string,
      key: decryptBytes(result.rows[0].encrypted_key as Buffer, sessionEncryptionKey()),
      expiresAt: new Date(result.rows[0].expires_at),
    };
  } catch {
    return null;
  }
}

export async function requireVaultSession(): Promise<VaultSession> {
  const session = await getVaultSession();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) await db.query("DELETE FROM vault_sessions WHERE token_hash = $1", [hashToken(token)]);
  store.delete(COOKIE_NAME);
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) throw new Error("FORBIDDEN_ORIGIN");
  let originHost: string;
  try { originHost = new URL(origin).host; } catch { throw new Error("FORBIDDEN_ORIGIN"); }
  if (originHost !== host) throw new Error("FORBIDDEN_ORIGIN");
}
