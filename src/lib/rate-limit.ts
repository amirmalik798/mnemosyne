import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";

/** Database-backed throttling remains effective across app instances/restarts. */
export async function enforceAuthRateLimit(
  request: Request,
  action: string,
  limit: number,
  windowSeconds: number,
  identifier = "",
): Promise<void> {
  const forwarded = request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const keys = [
    "ip:" + forwarded,
    ...(identifier ? ["identity:" + identifier.toLowerCase()] : []),
  ];

  for (const key of keys) {
    const keyHash = createHash("sha256").update(action + ":" + key).digest("hex");
    const result = await db.query(
      `INSERT INTO auth_rate_limits (action, key_hash, window_started_at, attempts)
       VALUES ($1, $2, NOW(), 1)
       ON CONFLICT (action, key_hash) DO UPDATE
       SET attempts = CASE
             WHEN auth_rate_limits.window_started_at <= NOW() - ($3 * INTERVAL '1 second') THEN 1
             ELSE auth_rate_limits.attempts + 1
           END,
           window_started_at = CASE
             WHEN auth_rate_limits.window_started_at <= NOW() - ($3 * INTERVAL '1 second') THEN NOW()
             ELSE auth_rate_limits.window_started_at
           END
       RETURNING attempts`,
      [action, keyHash, windowSeconds],
    );
    if (Number(result.rows[0]?.attempts ?? 0) > limit) {
      throw new Error("RATE_LIMITED");
    }
  }
}
