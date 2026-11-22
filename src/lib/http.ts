import { NextResponse } from "next/server";

export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Please unlock your vault." }, { status: 401 });
  if (message === "FORBIDDEN_ORIGIN") return NextResponse.json({ error: "Request origin was rejected." }, { status: 403 });
  if (message === "NOT_FOUND") return NextResponse.json({ error: "The requested item was not found." }, { status: 404 });
  if (message === "CONFLICT") return NextResponse.json({ error: "This item cannot be deleted while it contains notes." }, { status: 409 });
  if (message.startsWith("VALIDATION:")) return NextResponse.json({ error: message.slice(11) }, { status: 400 });
  console.error("API error:", error);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

export function requireJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("VALIDATION:Invalid request body.");
  return value as Record<string, unknown>;
}

export function stringField(obj: Record<string, unknown>, name: string, max = 10000, required = false): string {
  const value = obj[name];
  if (typeof value !== "string") {
    if (required) throw new Error(`VALIDATION:${name} is required.`);
    return "";
  }
  const clean = value.trim();
  if (required && !clean) throw new Error(`VALIDATION:${name} is required.`);
  if (clean.length > max) throw new Error(`VALIDATION:${name} is too long.`);
  return clean;
}
