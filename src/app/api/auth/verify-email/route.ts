import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { assertSameOrigin } from "@/lib/auth";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/crypto";
import { enforceAuthRateLimit } from "@/lib/rate-limit";
import { readJsonObject, stringField } from "@/lib/http";

export async function POST(request: Request) {
  let client: PoolClient | undefined;
  try {
    assertSameOrigin(request);
    await enforceAuthRateLimit(request, "verify-email", 10, 3600);
    const body = await readJsonObject(request, 8 * 1024);
    const token = stringField(body, "token", 128, true);
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) throw new Error("VALIDATION:This verification link is invalid or expired.");

    client = await db.connect();
    await client.query("BEGIN");
    const found = await client.query(
      "SELECT user_id FROM email_verification_tokens WHERE token_hash=$1 AND expires_at>NOW() FOR UPDATE",
      [hashToken(token)],
    );
    const userId = found.rows[0]?.user_id as string | undefined;
    if (!userId) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "This verification link is invalid or has expired. Request a new one." }, { status: 400 });
    }
    await client.query(
      "UPDATE users SET email_verified_at=COALESCE(email_verified_at,NOW()), updated_at=NOW() WHERE id=$1",
      [userId],
    );
    await client.query("DELETE FROM email_verification_tokens WHERE user_id=$1", [userId]);
    await client.query("COMMIT");
    return NextResponse.json({ success: true });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    const message = error instanceof Error ? error.message : "";
    if (message === "RATE_LIMITED") return NextResponse.json({ error: "Too many verification attempts. Try again later." }, { status: 429 });
    if (message.startsWith("VALIDATION:")) return NextResponse.json({ error: message.slice(11) }, { status: 400 });
    if (message === "FORBIDDEN_ORIGIN") return NextResponse.json({ error: "Request origin was rejected." }, { status: 403 });
    console.error("Email verification failed.", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Email verification is temporarily unavailable." }, { status: 500 });
  } finally {
    client?.release();
  }
}
