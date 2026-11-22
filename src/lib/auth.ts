import "server-only";
import { cache } from "react";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { decryptBytes, encryptBytes, hashToken, sessionEncryptionKey } from "@/lib/crypto";

const LEGACY_COOKIE_NAME = "mnemosyne_session";
const COOKIE_NAME = process.env.NODE_ENV === "production"
  ? "__Host-mnemosyne_session"
  : LEGACY_COOKIE_NAME;
const SESSION_HOURS = 12;
const SESSION_IDLE_MINUTES = 20;

type SessionQueryExecutor = (
  text: string,
  values: Array<string | Buffer | Date>,
) => Promise<{ rows: unknown[] }>;

export type VaultSession = { id: string; key: Buffer; expiresAt: Date };

export async function isVaultInitialized(): Promise<boolean> {
  const result = await db.query("SELECT 1 FROM vault_settings WHERE id = 1");
  return result.rowCount === 1;
}

/**
 * Insert a session record and return its one-time cookie token.
 * A caller may provide its active transaction so vault setup can commit the
 * vault settings and the first session together. Schema/insert errors then
 * roll back the entire first-run setup instead of leaving a locked vault.
 */
export async function createSessionRecord(
  vaultKey: Buffer,
  query?: SessionQueryExecutor,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  const encryptedKey = encryptBytes(vaultKey, sessionEncryptionKey());
  const values = [hashToken(token), encryptedKey, expiresAt];

  if (query) {
    await query(
      "INSERT INTO vault_sessions (token_hash, encrypted_key, expires_at, last_active_at) VALUES ($1, $2, $3, NOW())",
      values,
    );
  } else {
    await db.query(
      "INSERT INTO vault_sessions (token_hash, encrypted_key, expires_at, last_active_at) VALUES ($1, $2, $3, NOW())",
      values,
    );
  }

  return token;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  if (process.env.NODE_ENV === "production") {
    // __Host- cookies must be Secure, host-only and scoped to Path=/.
    // Remove the older cookie name so it cannot shadow the hardened cookie.
    store.delete(LEGACY_COOKIE_NAME);
  }
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    priority: "high",
    // Browser-session cookie: closing the browser normally requires the
    // master password again. The server also enforces absolute and idle expiry.
  });
}

export async function createSession(vaultKey: Buffer): Promise<void> {
  const token = await createSessionRecord(vaultKey);
  await setSessionCookie(token);
}

/**
 * The server enforces both the absolute session lifetime and the idle timeout.
 * Normal protected requests refresh last_active_at. The lightweight session
 * heartbeat explicitly opts out so an abandoned open tab cannot stay unlocked.
 */
const getVaultSessionCached = cache(async (touch: boolean): Promise<VaultSession | null> => {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);
  const result = touch
    ? await db.query(
        `UPDATE vault_sessions
         SET last_active_at = NOW()
         WHERE token_hash = $1
           AND expires_at > NOW()
           AND last_active_at > NOW() - ($2 * INTERVAL '1 minute')
         RETURNING id, encrypted_key, expires_at`,
        [tokenHash, SESSION_IDLE_MINUTES],
      )
    : await db.query(
        `SELECT id, encrypted_key, expires_at
         FROM vault_sessions
         WHERE token_hash = $1
           AND expires_at > NOW()
           AND last_active_at > NOW() - ($2 * INTERVAL '1 minute')
         LIMIT 1`,
        [tokenHash, SESSION_IDLE_MINUTES],
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
});

/**
 * Request-scoped memoization avoids repeating the same session database query
 * when the protected layout and its page both verify the same vault session.
 * The read-only heartbeat remains separate and never extends the idle lease.
 */
export function getVaultSession(
  options: { touch?: boolean } = {},
): Promise<VaultSession | null> {
  return getVaultSessionCached(options.touch !== false);
}

export async function requireVaultSession(
  options: { touch?: boolean } = {},
): Promise<VaultSession> {
  const session = await getVaultSession(options);
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const tokens = [
    store.get(COOKIE_NAME)?.value,
    store.get(LEGACY_COOKIE_NAME)?.value,
  ].filter((value): value is string => Boolean(value));

  if (tokens.length > 0) {
    await db.query(
      "DELETE FROM vault_sessions WHERE token_hash = ANY($1::text[])",
      [Array.from(new Set(tokens.map(hashToken)))],
    );
  }

  store.delete(COOKIE_NAME);
  if (COOKIE_NAME !== LEGACY_COOKIE_NAME) store.delete(LEGACY_COOKIE_NAME);
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host || host.includes(",") || /[\r\n\s]/.test(host)) {
    throw new Error("FORBIDDEN_ORIGIN");
  }

  let originHost: string;
  try {
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.protocol !== "https:" && parsedOrigin.protocol !== "http:") {
      throw new Error("Invalid origin protocol.");
    }
    originHost = parsedOrigin.host.toLowerCase();
  } catch {
    throw new Error("FORBIDDEN_ORIGIN");
  }

  if (originHost !== host.toLowerCase()) throw new Error("FORBIDDEN_ORIGIN");
}
