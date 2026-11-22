import { NextResponse } from "next/server";
import { requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { apiError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireVaultSession();
    const result = await db.query("SELECT category_enc FROM topics");
    const categories = Array.from(
      new Map(
        result.rows
          .map((row) => decryptText(row.category_enc, session.key).trim())
          .filter(Boolean)
          .map((category) => [category.toLocaleLowerCase(), category] as const),
      ).values(),
    ).sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ categories });
  } catch (error) {
    return apiError(error);
  }
}
