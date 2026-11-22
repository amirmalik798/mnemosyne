import { NextResponse } from "next/server";
import { derivePasswordKey, decryptBytes } from "@/lib/crypto";
import { createSession, assertSameOrigin } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError, requireJsonObject, stringField } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = requireJsonObject(await request.json());
    const password = stringField(body, "password", 256, true);
    const result = await db.query("SELECT password_salt, wrapped_key, failed_attempts, locked_until FROM vault_settings WHERE id = 1");
    if (!result.rows[0]) return NextResponse.json({ error: "Vault setup is required." }, { status: 404 });
    const settings = result.rows[0];
    if (settings.locked_until && new Date(settings.locked_until).getTime() > Date.now()) {
      return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
    }
    try {
      const wrappingKey = await derivePasswordKey(password, settings.password_salt as Buffer);
      const vaultKey = decryptBytes(settings.wrapped_key as Buffer, wrappingKey);
      await db.query("UPDATE vault_settings SET failed_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = 1");
      await createSession(vaultKey);
      return NextResponse.json({ success: true });
    } catch {
      const attempts = Number(settings.failed_attempts ?? 0) + 1;
      const lockedUntil = attempts >= 5 ? new Date(Date.now() + 10 * 60 * 1000) : null;
      await db.query("UPDATE vault_settings SET failed_attempts = $1, locked_until = $2, updated_at = NOW() WHERE id = 1", [lockedUntil ? 0 : attempts, lockedUntil]);
      return NextResponse.json({ error: "That password is not correct." }, { status: 401 });
    }
  } catch (error) { return apiError(error); }
}
