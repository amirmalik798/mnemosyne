import { NextResponse } from "next/server";
import { requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { apiError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await requireVaultSession();
    const params = new URL(request.url).searchParams;
    const hasPagination = params.has("limit") || params.has("offset");
    if (!hasPagination) {
      const result = await db.query(
        "SELECT id, title_enc FROM topics ORDER BY updated_at DESC, id DESC",
      );
      return NextResponse.json({
        topics: result.rows.map((row) => ({
          id: row.id,
          title: decryptText(row.title_enc, session.key),
        })),
      });
    }

    const requestedLimit = Number(params.get("limit") ?? 100);
    const requestedOffset = Number(params.get("offset") ?? 0);
    const limit = Number.isSafeInteger(requestedLimit) ? Math.min(200, Math.max(1, requestedLimit)) : 100;
    const offset = Number.isSafeInteger(requestedOffset) ? Math.min(1_000_000, Math.max(0, requestedOffset)) : 0;
    const [countResult, pageResult] = await Promise.all([
      db.query("SELECT COUNT(*)::int AS total FROM topics"),
      db.query(
        "SELECT id, title_enc FROM topics ORDER BY updated_at DESC, id DESC LIMIT $1 OFFSET $2",
        [limit, offset],
      ),
    ]);
    const topics = pageResult.rows.map((row) => ({
      id: row.id,
      title: decryptText(row.title_enc, session.key),
    }));
    const total = Number(countResult.rows[0]?.total ?? 0);
    return NextResponse.json({
      topics,
      pagination: { total, offset, limit, hasMore: offset + topics.length < total },
    });
  } catch (error) {
    return apiError(error);
  }
}
