import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "The single-user vault unlock endpoint has been retired. Sign in at /login." },
    { status: 410 },
  );
}
