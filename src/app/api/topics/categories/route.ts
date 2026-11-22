import { NextResponse } from "next/server";
import { requireVaultSession } from "@/lib/auth";
import { queryAsUser } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { apiError } from "@/lib/http";

export const dynamic = "force-dynamic";
const CATEGORY_PAGE_SIZE = 100;

export async function GET() {
  try {
    const session = await requireVaultSession();
    // Randomized authenticated ciphertext cannot be DISTINCT'ed by plaintext.
    // The small category catalogue is bounded by the UI's per-topic input
    // length; this route decrypts only the category column, never topic bodies.
    const result = await queryAsUser(session.userId, 
      "SELECT category_enc FROM topics",
    );
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
