import { NextResponse } from "next/server";
import { assertSameOrigin, destroySession } from "@/lib/auth";
import { apiError } from "@/lib/http";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await destroySession();
    return NextResponse.json({ success: true });
  } catch (error) { return apiError(error); }
}
