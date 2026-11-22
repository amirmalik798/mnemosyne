import "server-only";
import { NextResponse } from "next/server";

export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Please unlock your vault." }, { status: 401 });
  if (message === "FORBIDDEN_ORIGIN") return NextResponse.json({ error: "Request origin was rejected." }, { status: 403 });
  if (message === "PAYLOAD_TOO_LARGE") return NextResponse.json({ error: "The request is too large." }, { status: 413 });
  if (message === "UNSUPPORTED_MEDIA_TYPE") return NextResponse.json({ error: "Send this request using the expected content type." }, { status: 415 });
  if (message === "NOT_FOUND") return NextResponse.json({ error: "The requested item was not found." }, { status: 404 });
  if (message === "CONFLICT") return NextResponse.json({ error: "This item cannot be deleted while it contains notes." }, { status: 409 });
  if (message === "ASSET_IN_USE") return NextResponse.json({ error: "This image is still used by a note. Remove it from the note and save before deleting the image." }, { status: 409 });
  if (message.startsWith("VALIDATION:")) return NextResponse.json({ error: message.slice(11) }, { status: 400 });

  const errorName = error instanceof Error ? error.name : "UnknownError";
  const errorCode = error && typeof error === "object" && "code" in error
    && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;

  // PostgreSQL's undefined_column and undefined_table errors commonly mean
  // npm run db:migrate has not been run against this exact DATABASE_URL.
  // Return an actionable response without exposing SQL or schema details.
  if (errorCode === "42703" || errorCode === "42P01") {
    console.error("Database schema is missing a required column or table.", {
      code: errorCode,
    });
    return NextResponse.json(
      { error: "The database schema is out of date. Run npm run db:migrate, then npm run db:check, and restart the application." },
      { status: 503 },
    );
  }

  console.error("API error occurred.", { name: errorName, code: errorCode });
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

export function requireJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("VALIDATION:Invalid request body.");
  return value as Record<string, unknown>;
}

/** Read JSON with a hard byte limit instead of buffering an unbounded request body. */
export async function readJsonObject(
  request: Request,
  maxBytes = 64 * 1024,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new Error("UNSUPPORTED_MEDIA_TYPE");

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("PAYLOAD_TOO_LARGE");
  }

  const reader = request.body?.getReader();
  if (!reader) throw new Error("VALIDATION:Request body is empty.");

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("PAYLOAD_TOO_LARGE");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  const payload = Buffer.concat(chunks, totalBytes);
  chunks.length = 0;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new Error("VALIDATION:Request body must contain valid JSON.");
  }
  return requireJsonObject(parsed);
}

/** Parse multipart uploads only after enforcing an overall byte limit. */
export async function readBoundedFormData(
  request: Request,
  maxBytes: number,
): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    throw new Error("UNSUPPORTED_MEDIA_TYPE");
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("PAYLOAD_TOO_LARGE");
  }

  const reader = request.body?.getReader();
  if (!reader) throw new Error("VALIDATION:Upload body is empty.");

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("PAYLOAD_TOO_LARGE");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  try {
    // Drop references to the streamed chunks before parsing the single
    // contiguous multipart payload to avoid retaining two full upload copies.
    const payload = Buffer.concat(chunks, totalBytes);
    chunks.length = 0;
    return await new Response(payload, {
      headers: { "Content-Type": contentType },
    }).formData();
  } catch {
    throw new Error("VALIDATION:Upload form data is invalid or incomplete.");
  }
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
