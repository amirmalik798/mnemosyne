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
const SESSION_TOUCH_INTERVAL_MINUTES = 1;

type SessionQueryExecutor = (
  text: string,
  values: Array<string | Buffer | Date>,
) => Promise<{ rows: unknown[] }>;

export type VaultSession = {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  key: Buffer;
  expiresAt: Date;
};

/** Create a session row inside an optional caller-owned transaction. */
export async function createSessionRecord(
  userId: string,
  vaultKey: Buffer,
  query?: SessionQueryExecutor,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  const encryptedKey = encryptBytes(vaultKey, sessionEncryptionKey());
  const values = [userId, hashToken(token), encryptedKey, expiresAt];
  const statement =
    "INSERT INTO user_sessions (user_id, token_hash, encrypted_key, expires_at, last_active_at) " +
    "VALUES ($1, $2, $3, $4, NOW())";

  if (query) await query(statement, values);
  else await db.query(statement, values);
  return token;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  if (process.env.NODE_ENV === "production") store.delete(LEGACY_COOKIE_NAME);
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    priority: "high",
  });
}

const getVaultSessionCached = cache(async (touch: boolean): Promise<VaultSession | null> => {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);
  const result = touch
    ? await db.query(
        `WITH candidate AS MATERIALIZED (
           SELECT s.id, s.user_id, s.encrypted_key, s.expires_at,
                  s.last_active_at, u.email, u.display_name
           FROM user_sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = $1
             AND s.expires_at > NOW()
             AND s.last_active_at > NOW() - ($2 * INTERVAL '1 minute')
             AND u.email_verified_at IS NOT NULL
           LIMIT 1
         ),
         touched AS (
           UPDATE user_sessions s
           SET last_active_at = NOW()
           FROM candidate c
           WHERE s.id = c.id
             AND s.last_active_at <= NOW() - ($3 * INTERVAL '1 minute')
           RETURNING s.id
         )
         SELECT id, user_id, encrypted_key, expires_at, email, display_name
         FROM candidate`,
        [tokenHash, SESSION_IDLE_MINUTES, SESSION_TOUCH_INTERVAL_MINUTES],
      )
    : await db.query(
        `SELECT s.id, s.user_id, s.encrypted_key, s.expires_at, u.email, u.display_name
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1
           AND s.expires_at > NOW()
           AND s.last_active_at > NOW() - ($2 * INTERVAL '1 minute')
           AND u.email_verified_at IS NOT NULL
         LIMIT 1`,
        [tokenHash, SESSION_IDLE_MINUTES],
      );

  const row = result.rows[0] as {
    id: string;
    user_id: string;
    encrypted_key: Buffer;
    expires_at: Date;
    email: string;
    display_name: string;
  } | undefined;
  if (!row) return null;

  try {
    return {
      id: row.id,
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      key: decryptBytes(row.encrypted_key, sessionEncryptionKey()),
      expiresAt: new Date(row.expires_at),
    };
  } catch {
    return null;
  }
});

export function getVaultSession(options: { touch?: boolean } = {}): Promise<VaultSession | null> {
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
      "DELETE FROM user_sessions WHERE token_hash = ANY($1::text[])",
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
