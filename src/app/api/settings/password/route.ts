import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { assertSameOrigin, requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { derivePasswordKey, decryptBytes, encryptBytes } from "@/lib/crypto";
import { apiError, readJsonObject, stringField } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let client: Awaited<ReturnType<typeof db.connect>> | undefined;
  let oldWrappingKey: Buffer | undefined;
  let newWrappingKey: Buffer | undefined;
  let unlocked: Buffer | undefined;

  try {
    assertSameOrigin(request);
    const session = await requireVaultSession();
    const body = await readJsonObject(request, 8 * 1024);
    const currentPassword = stringField(body, "currentPassword", 256, true);
    const newPassword = stringField(body, "newPassword", 256, true);
    if (newPassword.length < 12) throw new Error("VALIDATION:Use at least 12 characters for your new password.");

    client = await db.connect();
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT password_salt, wrapped_key FROM vault_settings WHERE id = 1 FOR UPDATE",
    );
    if (!result.rows[0]) throw new Error("NOT_FOUND");

    oldWrappingKey = await derivePasswordKey(currentPassword, result.rows[0].password_salt as Buffer);
    try {
      unlocked = decryptBytes(result.rows[0].wrapped_key as Buffer, oldWrappingKey);
    } catch {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Your current password is incorrect." }, { status: 401 });
    } finally {
      oldWrappingKey.fill(0);
    }

    if (!unlocked.equals(session.key)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "The current password could not be verified." }, { status: 401 });
    }

    const salt = randomBytes(16);
    newWrappingKey = await derivePasswordKey(newPassword, salt);
    const wrappedKey = encryptBytes(session.key, newWrappingKey);
    newWrappingKey.fill(0);

    await client.query(
      "UPDATE vault_settings SET password_salt=$1, wrapped_key=$2, failed_attempts=0, locked_until=NULL, updated_at=NOW() WHERE id=1",
      [salt, wrappedKey],
    );
    // Revoke every other browser/device session in the same transaction as
    // the credential rotation. Keep only the session that changed the password.
    await client.query("DELETE FROM vault_sessions WHERE id <> $1", [session.id]);
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
