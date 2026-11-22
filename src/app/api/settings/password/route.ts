import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { randomBytes } from "node:crypto";
import { assertSameOrigin, requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { derivePasswordKey, decryptBytes, encryptBytes, hashPassword, verifyPassword } from "@/lib/crypto";
import { apiError, readJsonObject, stringField } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let client: PoolClient | undefined;
  let oldWrappingKey: Buffer | undefined;
  let newWrappingKey: Buffer | undefined;
  let unlocked: Buffer | undefined;

  try {
    assertSameOrigin(request);
    const session = await requireVaultSession();
    const body = await readJsonObject(request, 8 * 1024);
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (!currentPassword || currentPassword.length > 256) {
      throw new Error("VALIDATION:Enter your current password (256 characters or fewer).");
    }
    if (newPassword.length < 16 || newPassword.length > 256 || !newPassword.trim()) {
      throw new Error("VALIDATION:Use a password between 16 and 256 characters that is not only whitespace.");
    }

    client = await db.connect();
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT password_hash, password_salt, wrapped_key FROM users WHERE id=$1 FOR UPDATE",
      [session.userId],
    );
    if (!result.rows[0]) throw new Error("NOT_FOUND");

    const account = result.rows[0];
    if (typeof account.password_hash !== "string" || !(await verifyPassword(account.password_hash, currentPassword))) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Your current password is incorrect." }, { status: 401 });
    }

    oldWrappingKey = await derivePasswordKey(currentPassword, account.password_salt as Buffer);
    try {
      unlocked = decryptBytes(account.wrapped_key as Buffer, oldWrappingKey);
    } catch {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Your current password could not unlock the account key." }, { status: 401 });
    } finally {
      oldWrappingKey.fill(0);
      oldWrappingKey = undefined;
    }

    if (!unlocked.equals(session.key)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "The active session key does not match the account key." }, { status: 401 });
    }

    const salt = randomBytes(16);
    newWrappingKey = await derivePasswordKey(newPassword, salt);
    const wrappedKey = encryptBytes(session.key, newWrappingKey);
    const passwordHash = await hashPassword(newPassword);
    newWrappingKey.fill(0);
    newWrappingKey = undefined;

    await client.query(
      "UPDATE users SET password_hash=$1, password_salt=$2, wrapped_key=$3, failed_attempts=0, locked_until=NULL, updated_at=NOW() WHERE id=$4",
      [passwordHash, salt, wrappedKey, session.userId],
    );
    await client.query(
      "DELETE FROM user_sessions WHERE user_id=$1 AND id<>$2",
      [session.userId, session.id],
    );
    await client.query("COMMIT");
    return NextResponse.json({ success: true });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    return apiError(error);
  } finally {
    oldWrappingKey?.fill(0);
    newWrappingKey?.fill(0);
    unlocked?.fill(0);
    client?.release();
  }
}
