import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { assertSameOrigin, requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { derivePasswordKey, decryptBytes, encryptBytes } from "@/lib/crypto";
import { apiError, requireJsonObject, stringField } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireVaultSession();
    const body = requireJsonObject(await request.json());
    const currentPassword = stringField(body, "currentPassword", 256, true);
    const newPassword = stringField(body, "newPassword", 256, true);
    if (newPassword.length < 12) throw new Error("VALIDATION:Use at least 12 characters for your new password.");
    const result = await db.query("SELECT password_salt, wrapped_key FROM vault_settings WHERE id=1");
    if (!result.rows[0]) throw new Error("NOT_FOUND");
    const oldWrappingKey = await derivePasswordKey(currentPassword, result.rows[0].password_salt);
    let unlocked: Buffer;
    try { unlocked = decryptBytes(result.rows[0].wrapped_key, oldWrappingKey); }
    catch { return NextResponse.json({ error: "Your current password is incorrect." }, { status: 401 }); }
    if (!unlocked.equals(session.key)) return NextResponse.json({ error: "The current password could not be verified." }, { status: 401 });
    const salt = randomBytes(16);
    const newWrappingKey = await derivePasswordKey(newPassword, salt);
    const wrappedKey = encryptBytes(session.key, newWrappingKey);
    await db.query("UPDATE vault_settings SET password_salt=$1, wrapped_key=$2, failed_attempts=0, locked_until=NULL, updated_at=NOW() WHERE id=1", [salt, wrappedKey]);
    await db.query("DELETE FROM vault_sessions WHERE id <> $1", [session.id]);
    return NextResponse.json({ success: true });
  } catch (error) { return apiError(error); }
}
