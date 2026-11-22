import { NextResponse } from "next/server";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
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
