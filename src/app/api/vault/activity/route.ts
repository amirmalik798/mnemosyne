import { NextResponse } from "next/server";
import { assertSameOrigin, requireVaultSession } from "@/lib/auth";
import { apiError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    // A real user interaction refreshes last_active_at on the shared server
    // session. This lets activity in one tab keep the same session alive while
    // another tab is idle, without a background heartbeat extending the lease.
    await requireVaultSession();
    return new NextResponse(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
