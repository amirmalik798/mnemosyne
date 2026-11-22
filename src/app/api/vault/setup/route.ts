import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { derivePasswordKey, encryptBytes, newVaultKey } from "@/lib/crypto";
import { createSession, isVaultInitialized, assertSameOrigin } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError, readJsonObject, stringField } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (await isVaultInitialized()) return NextResponse.json({ error: "The vault has already been set up." }, { status: 409 });
    const body = await readJsonObject(request, 8 * 1024);
    const password = stringField(body, "password", 256, true);
    if (password.length < 12) throw new Error("VALIDATION:Use at least 12 characters for your master password.");
    const confirmation = stringField(body, "confirmation", 256, true);
    if (password !== confirmation) throw new Error("VALIDATION:Your passwords do not match.");
    const salt = randomBytes(16);
    const wrappingKey = await derivePasswordKey(password, salt);
    const vaultKey = newVaultKey();
    const wrappedKey = encryptBytes(vaultKey, wrappingKey);
    const created = await db.query(
      "INSERT INTO vault_settings (id, password_salt, wrapped_key) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING RETURNING id",
      [salt, wrappedKey],
    );
    if (!created.rows[0]) {
      return NextResponse.json({ error: "The vault has already been set up." }, { status: 409 });
    }
    await createSession(vaultKey);
    wrappingKey.fill(0);
    vaultKey.fill(0);
    return NextResponse.json({ success: true });
  } catch (error) { return apiError(error); }
}
