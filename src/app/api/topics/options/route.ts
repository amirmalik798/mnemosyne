import { NextResponse } from "next/server";
import { requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { apiError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireVaultSession();
    const result = await db.query(
      "SELECT id, title_enc FROM topics ORDER BY updated_at DESC, id DESC",
    );
    const topics = result.rows.map((row) => ({
      id: row.id,
      title: decryptText(row.title_enc, session.key),
    }));
    return NextResponse.json({ topics });
  } catch (error) {
    return apiError(error);
  }
}
