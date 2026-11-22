import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { derivePasswordKey, encryptBytes, newVaultKey, sessionEncryptionKey } from "@/lib/crypto";
import {
  createSessionRecord,
  isVaultInitialized,
  setSessionCookie,
  assertSameOrigin,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError, readJsonObject, stringField } from "@/lib/http";

export const runtime = "nodejs";

const SETUP_ADVISORY_LOCK_ID = 724_918_237_442;

export async function POST(request: Request) {
  let client: PoolClient | undefined;
  let wrappingKey: Buffer | undefined;
  let vaultKey: Buffer | undefined;

  try {
    assertSameOrigin(request);
    if (await isVaultInitialized()) {
      return NextResponse.json({ error: "The vault has already been set up." }, { status: 409 });
    }

    const body = await readJsonObject(request, 8 * 1024);
    const configuredSetupToken = process.env.VAULT_SETUP_TOKEN;
    if (process.env.NODE_ENV === "production" && (!configuredSetupToken || Buffer.byteLength(configuredSetupToken) < 32)) {
      return NextResponse.json(
        { error: "Secure first-time setup is disabled. Configure a random VAULT_SETUP_TOKEN of at least 32 characters on the server." },
        { status: 503 },
      );
    }

    if (configuredSetupToken) {
      if (Buffer.byteLength(configuredSetupToken) < 32) {
        throw new Error("VALIDATION:VAULT_SETUP_TOKEN must contain at least 32 characters.");
      }
      const suppliedSetupToken = stringField(body, "setupToken", 256, true);
      const suppliedHash = createHash("sha256").update(suppliedSetupToken).digest();
      const expectedHash = createHash("sha256").update(configuredSetupToken).digest();
      if (!timingSafeEqual(suppliedHash, expectedHash)) {
        return NextResponse.json({ error: "The one-time setup key is not correct." }, { status: 403 });
      }
    }

    const password = stringField(body, "password", 256, true);
    if (password.length < 16) throw new Error("VALIDATION:Use at least 16 characters for your master password.");
    const confirmation = stringField(body, "confirmation", 256, true);
    if (password !== confirmation) throw new Error("VALIDATION:Your passwords do not match.");

    const sessionKeyCheck = sessionEncryptionKey();
    sessionKeyCheck.fill(0);
    const salt = randomBytes(16);
    wrappingKey = await derivePasswordKey(password, salt);
    vaultKey = newVaultKey();
    const wrappedKey = encryptBytes(vaultKey, wrappingKey);

    // Serialize first-run requests and re-check the database inside the same
    // transaction as both the vault key wrapper and the first session record.
    // If the DB schema is outdated, session insertion fails and setup rolls
    // back completely rather than leaving an initialized but inaccessible vault.
    client = await db.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [SETUP_ADVISORY_LOCK_ID]);

    const existingSettings = await client.query(
      "SELECT 1 FROM vault_settings WHERE id = 1 FOR UPDATE",
    );
    if (existingSettings.rows[0]) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "The vault has already been set up." }, { status: 409 });
    }

    // Missing settings do not mean this database is a new vault. Old sessions
    // may still contain the original vault key, and encrypted rows still need
    // that key. Refuse to create a replacement key over existing archive data.
    const existingArchive = await client.query(
      "SELECT " +
        "EXISTS (SELECT 1 FROM vault_sessions) AS has_sessions, " +
        "EXISTS (SELECT 1 FROM topics) AS has_topics, " +
        "EXISTS (SELECT 1 FROM notes) AS has_notes, " +
        "EXISTS (SELECT 1 FROM assets) AS has_assets",
    );
    const state = existingArchive.rows[0] as {
      has_sessions: boolean;
      has_topics: boolean;
      has_notes: boolean;
      has_assets: boolean;
    };

    if (state.has_sessions || state.has_topics || state.has_notes || state.has_assets) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error:
            "Vault setup was blocked because encrypted archive data or previous sessions already exist, but the vault settings are missing. Restore the original vault_settings row from a trusted backup before continuing. Creating a new vault here could permanently disconnect existing records from their encryption key.",
        },
        { status: 409 },
      );
    }

    const created = await client.query(
      "INSERT INTO vault_settings (id, password_salt, wrapped_key) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING RETURNING id",
      [salt, wrappedKey],
    );
    if (!created.rows[0]) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "The vault has already been set up." }, { status: 409 });
    }

    // Keep the session row in this transaction. If last_active_at (or another
    // required session column) is missing, neither vault_settings nor the
    // initial session is committed.
    const sessionToken = await createSessionRecord(
      vaultKey,
      (text, values) => client!.query(text, values),
    );

    await client.query("COMMIT");
    client.release();
    client = undefined;

    // Only emit the browser cookie after PostgreSQL confirms the transaction.
    await setSessionCookie(sessionToken);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    return apiError(error);
  } finally {
    client?.release();
    wrappingKey?.fill(0);
    vaultKey?.fill(0);
  }
}
