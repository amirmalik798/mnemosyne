import { NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import type { PoolClient } from "pg";
import { assertSameOrigin, createSessionRecord, setSessionCookie } from "@/lib/auth";
import { db } from "@/lib/db";
import { derivePasswordKey } from "@/lib/crypto";
import { issueEmailVerificationToken, normalizeEmail, verifyAccountPassword } from "@/lib/accounts";
import { sendVerificationEmail } from "@/lib/email";
import { enforceAuthRateLimit } from "@/lib/rate-limit";
import { readJsonObject, stringField } from "@/lib/http";

export const runtime = "nodejs";
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 10;

export async function POST(request: Request) {
  let client: PoolClient | undefined;
  let vaultKey: Buffer | null = null;
  let sessionToken: string | undefined;
  let verification: { email: string; token: string } | undefined;

  try {
    assertSameOrigin(request);
    const body = await readJsonObject(request, 8 * 1024);
    const email = normalizeEmail(stringField(body, "email", 254, true));
    const password = typeof body.password === "string" ? body.password : "";
    if (!password || password.length > 256) throw new Error("VALIDATION:Enter your account password.");

    await enforceAuthRateLimit(request, "login", 8, 900, email);

    client = await db.connect();
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT id, email, display_name, password_hash, password_salt, wrapped_key, failed_attempts, locked_until, email_verified_at " +
      "FROM users WHERE email=$1 FOR UPDATE",
      [email],
    );
    const user = result.rows[0];

    if (!user) {
      // Spend comparable Argon2 work for unknown addresses to reduce timing
      // differences that could otherwise assist account enumeration.
      const dummy = await derivePasswordKey(password, Buffer.alloc(16, 0x5a));
      dummy.fill(0);
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
    }

    const lockedUntil = user.locked_until ? new Date(user.locked_until) : null;
    if (lockedUntil && lockedUntil.getTime() > Date.now()) {
      const dummy = await derivePasswordKey(password, Buffer.alloc(16, 0x5a));
      dummy.fill(0);
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
    }

    vaultKey = await verifyAccountPassword(
      (text, values = []) => client!.query(text, values),
      user,
      password,
    );

    if (!vaultKey) {
      const attempts = Number(user.failed_attempts ?? 0) + 1;
      const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
      await client.query(
        "UPDATE users SET failed_attempts=$1, locked_until=$2, updated_at=NOW() WHERE id=$3",
        [
          shouldLock ? 0 : attempts,
          shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null,
          user.id,
        ],
      );
      await client.query("COMMIT");
      return NextResponse.json(
        { error: "Email or password is incorrect." },
        { status: 401 },
      );
    }

    await client.query(
      "UPDATE users SET failed_attempts=0, locked_until=NULL, updated_at=NOW() WHERE id=$1",
      [user.id],
    );

    if (!user.email_verified_at) {
      const token = await issueEmailVerificationToken(
        (text, values = []) => client!.query(text, values),
        user.id,
      );
      verification = { email: user.email as string, token };
      await client.query("COMMIT");
      client.release();
      client = undefined;
      vaultKey.fill(0);
      vaultKey = null;

      try {
        await sendVerificationEmail(verification.email, verification.token);
      } catch {
        return NextResponse.json(
          { error: "EMAIL_NOT_VERIFIED", message: "Verify your email address before signing in. Email delivery is currently unavailable; contact the administrator or configure the email gateway." },
          { status: 503 },
        );
      }
      return NextResponse.json(
        { error: "EMAIL_NOT_VERIFIED", message: "We sent a new verification link to your email address." },
        { status: 403 },
      );
    }

    sessionToken = await createSessionRecord(
      user.id as string,
      vaultKey,
      (text, values) => client!.query(text, values),
    );
    await client.query("COMMIT");
    client.release();
    client = undefined;
    await setSessionCookie(sessionToken);
    return NextResponse.json({ success: true, user: { id: user.id, email: user.email, displayName: user.display_name } });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    const message = error instanceof Error ? error.message : "";
    if (message === "RATE_LIMITED") return NextResponse.json({ error: "Too many sign-in requests. Please wait and try again." }, { status: 429 });
    if (message.startsWith("VALIDATION:")) return NextResponse.json({ error: message.slice(11) }, { status: 400 });
    if (message === "FORBIDDEN_ORIGIN") return NextResponse.json({ error: "Request origin was rejected." }, { status: 403 });
    return apiError(error);
  } finally {
    client?.release();
    vaultKey?.fill(0);
  }
}
