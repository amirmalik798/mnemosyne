import { NextResponse } from "next/server";
import { requireVaultSession } from "@/lib/auth";
import { apiError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireVaultSession({ touch: false });
    return NextResponse.json(
      {
        userId: session.userId,
        email: session.email,
        displayName: session.displayName,
        expiresAt: session.expiresAt.toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
