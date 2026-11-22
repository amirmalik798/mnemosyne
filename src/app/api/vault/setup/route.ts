import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "The single-user vault setup endpoint has been retired. Create an account at /register." },
    { status: 410 },
  );
}
