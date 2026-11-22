import { NextResponse } from "next/server";
import { derivePasswordKey, decryptBytes } from "@/lib/crypto";
import { createSession, assertSameOrigin } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError, readJsonObject, stringField } from "@/lib/http";

export const runtime = "nodejs";

const UNLOCK_ADVISORY_LOCK_ID = 724_918_237_441;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 10;
const MAX_PASSWORD_REQUEST_BYTES = 8 * 1024;

export async function POST(request: Request) {
  let client: Awaited<ReturnType<typeof db.connect>> | undefined;
  let vaultKey: Buffer | null = null;

  try {
    assertSameOrigin(request);
    const body = await readJsonObject(request, MAX_PASSWORD_REQUEST_BYTES);
    const password = stringField(body, "password", 256, true);

    // Serialize verification attempts on the single vault row. Without this
    // lock, parallel requests can all read the same failed_attempts value and
    // overwrite one another, weakening the lockout and amplifying Argon2 load.
    client = await db.connect();
    await client.query("BEGIN");
    // Transaction-level advisory locks work with PostgreSQL transaction
    // poolers too and are released automatically on COMMIT or ROLLBACK.
    const lockResult = await client.query(
      "SELECT pg_try_advisory_xact_lock($1::bigint) AS acquired",
      [UNLOCK_ADVISORY_LOCK_ID],
    );
    if (!lockResult.rows[0]?.acquired) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Another unlock attempt is being verified. Please wait a moment." },
        { status: 429, headers: { "Retry-After": "2" } },
      );
    }

    const result = await client.query(
      "SELECT password_salt, wrapped_key, failed_attempts, locked_until FROM vault_settings WHERE id = 1 FOR UPDATE",
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Vault setup is required." }, { status: 404 });
    }

    const settings = result.rows[0];
    const lockedUntil = settings.locked_until ? new Date(settings.locked_until) : null;
    if (lockedUntil && lockedUntil.getTime() > Date.now()) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 1000))) } },
      );
    }

    // Keep the expensive password derivation inside the row lock so that
    // multiple guesses cannot be verified concurrently against this vault.
    const wrappingKey = await derivePasswordKey(password, settings.password_salt as Buffer);
    let passwordMatched = false;
    try {
      vaultKey = decryptBytes(settings.wrapped_key as Buffer, wrappingKey);
      passwordMatched = true;
    } catch {
      // Authentication failure is recorded below while the row and advisory
      // lock are still held, preventing simultaneous guesses from racing.
    } finally {
      wrappingKey.fill(0);
    }

    if (!passwordMatched) {
      const attempts = Number(settings.failed_attempts ?? 0) + 1;
      const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
      const nextLockedUntil = shouldLock
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
        : null;

      await client.query(
        `UPDATE vault_settings
         SET failed_attempts = $1, locked_until = $2, updated_at = NOW()
         WHERE id = 1`,
        [shouldLock ? 0 : attempts, nextLockedUntil],
      );
      await client.query("COMMIT");

      return NextResponse.json(
        { error: shouldLock ? "Too many attempts. The vault is locked for 10 minutes." : "That password is not correct." },
        { status: 401 },
      );
    }

    await client.query(
      "UPDATE vault_settings SET failed_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = 1",
    );
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    return apiError(error);
  } finally {
    client?.release();
  }

  try {
    if (!vaultKey) throw new Error("UNEXPECTED_UNLOCK_STATE");
    await createSession(vaultKey);
    return NextResponse.json({ success: true });
  } catch (error) {
    return apiError(error);
  } finally {
    vaultKey?.fill(0);
  }
}
