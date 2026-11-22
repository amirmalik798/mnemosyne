import { NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import type { PoolClient } from "pg";
import { randomBytes } from "node:crypto";
import { assertSameOrigin } from "@/lib/auth";
import { db } from "@/lib/db";
import { derivePasswordKey, encryptBytes, hashPassword, newVaultKey } from "@/lib/crypto";
import { issueEmailVerificationToken, normalizeEmail } from "@/lib/accounts";
import { sendVerificationEmail } from "@/lib/email";
import { enforceAuthRateLimit } from "@/lib/rate-limit";
import { readJsonObject, stringField } from "@/lib/http";

export const runtime = "nodejs";

function databaseCode(error: unknown): string | null {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : null;
}

export async function POST(request: Request) {
  let client: PoolClient | undefined;
  let wrappingKey: Buffer | undefined;
  let vaultKey: Buffer | undefined;

  try {
    assertSameOrigin(request);
    const body = await readJsonObject(request, 16 * 1024);
    const email = normalizeEmail(stringField(body, "email", 254, true));
    const displayName = stringField(body, "displayName", 80, true);
    const password = typeof body.password === "string" ? body.password : "";
    const confirmation = typeof body.confirmation === "string" ? body.confirmation : "";

    if (password.length < 16 || password.length > 256) {
      throw new Error("VALIDATION:Use a password between 16 and 256 characters.");
    }
    if (password !== confirmation) throw new Error("VALIDATION:Your passwords do not match.");

    await enforceAuthRateLimit(request, "register", 8, 3600, email);

    const passwordSalt = randomBytes(16);
    wrappingKey = await derivePasswordKey(password, passwordSalt);
    vaultKey = newVaultKey();
    const wrappedKey = encryptBytes(vaultKey, wrappingKey);
    const passwordHash = await hashPassword(password);

    client = await db.connect();
    await client.query("BEGIN");
    const created = await client.query(
      `INSERT INTO users (email, display_name, password_hash, password_salt, wrapped_key)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id`,
      [email, displayName, passwordHash, passwordSalt, wrappedKey],
    );
    const userId = created.rows[0].id as string;
    const token = await issueEmailVerificationToken(
      (text, values = []) => client!.query(text, values),
      userId,
    );
    await client.query("COMMIT");
    client.release();
    client = undefined;

    try {
      await sendVerificationEmail(email, token);
    } catch {
      return NextResponse.json(
        { success: true, message: "If this address can be registered, a confirmation email will be sent. If you do not receive one, sign in to request another." },
        { status: 202 },
      );
    }

    return NextResponse.json(
      { success: true, message: "If this address can be registered, a confirmation email will be sent. If you do not receive one, sign in to request another." },
      { status: 202 },
    );
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    if (databaseCode(error) === "23505") {
      // Do not reveal whether an email address is already registered.
      return NextResponse.json(
        { success: true, message: "If this address can be registered, a confirmation email will be sent. If you do not receive one, sign in to request another." },
        { status: 202 },
      );
    }
    const message = error instanceof Error ? error.message : "";
    if (message === "RATE_LIMITED") return NextResponse.json({ error: "Too many account requests. Please try again later." }, { status: 429 });
    if (message.startsWith("VALIDATION:")) return NextResponse.json({ error: message.slice(11) }, { status: 400 });
    if (message === "FORBIDDEN_ORIGIN") return NextResponse.json({ error: "Request origin was rejected." }, { status: 403 });
    return apiError(error);
  } finally {
    client?.release();
    wrappingKey?.fill(0);
    vaultKey?.fill(0);
  }
}
