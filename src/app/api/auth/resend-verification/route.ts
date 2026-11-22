import { NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import type { PoolClient } from "pg";
import { assertSameOrigin } from "@/lib/auth";
import { db } from "@/lib/db";
import { issueEmailVerificationToken, normalizeEmail, verifyAccountPassword } from "@/lib/accounts";
import { sendVerificationEmail } from "@/lib/email";
import { enforceAuthRateLimit } from "@/lib/rate-limit";
import { readJsonObject, stringField } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let client: PoolClient | undefined;
  let vaultKey: Buffer | null = null;
  let verification: { email: string; token: string } | undefined;

  try {
    assertSameOrigin(request);
    const body = await readJsonObject(request, 8 * 1024);
    const email = normalizeEmail(stringField(body, "email", 254, true));
    const password = typeof body.password === "string" ? body.password : "";
    if (!password || password.length > 256) throw new Error("VALIDATION:Enter your account password.");

    await enforceAuthRateLimit(request, "resend-verification", 3, 3600, email);

    client = await db.connect();
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT id, email, password_hash, password_salt, wrapped_key, email_verified_at FROM users WHERE email=$1 FOR UPDATE",
      [email],
    );
    const user = result.rows[0];

    // The same response is returned for unknown addresses, incorrect
    // passwords and already verified accounts.
    if (!user) {
      await client.query("ROLLBACK");
      return NextResponse.json({ success: true, message: "If the account is eligible, a verification message will be sent." });
    }
    vaultKey = await verifyAccountPassword(
      (text, values = []) => client!.query(text, values),
      user,
      password,
    );
    if (!vaultKey || user.email_verified_at) {
      await client.query("COMMIT");
      return NextResponse.json({ success: true, message: "If the account is eligible, a verification message will be sent." });
    }

    const token = await issueEmailVerificationToken(
      (text, values = []) => client!.query(text, values),
      user.id,
    );
    verification = { email: user.email, token };
    await client.query("COMMIT");
    client.release();
    client = undefined;
    vaultKey.fill(0);
    vaultKey = null;

    try {
      await sendVerificationEmail(verification.email, verification.token);
    } catch {
      return NextResponse.json({ error: "Email delivery is unavailable. Please try again later or contact the administrator." }, { status: 503 });
    }
    return NextResponse.json({ success: true, message: "If the account is eligible, a verification message will be sent." });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    const message = error instanceof Error ? error.message : "";
    if (message === "RATE_LIMITED") return NextResponse.json({ error: "Too many verification messages requested. Try again later." }, { status: 429 });
    if (message.startsWith("VALIDATION:")) return NextResponse.json({ error: message.slice(11) }, { status: 400 });
    if (message === "FORBIDDEN_ORIGIN") return NextResponse.json({ error: "Request origin was rejected." }, { status: 403 });
    return apiError(error);
  } finally {
    client?.release();
    vaultKey?.fill(0);
  }
}
