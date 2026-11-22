import { NextResponse } from "next/server";
import { assertSameOrigin, requireVaultSession } from "@/lib/auth";
import { db, queryAsUser } from "@/lib/db";
import { decryptText, encryptText } from "@/lib/crypto";
import { apiError, readJsonObject, stringField } from "@/lib/http";

export const runtime = "nodejs";

function parseBoundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function serializeNote(row: Record<string, unknown>, key: Buffer) {
  return {
    id: row.id,
    topicId: row.topic_id,
    topicTitle: decryptText(row.topic_title_enc as Buffer, key),
    title: decryptText(row.title_enc as Buffer, key),
    subject: decryptText(row.subject_enc as Buffer, key),
    content: JSON.parse(decryptText(row.content_enc as Buffer, key)),
    tags: JSON.parse(decryptText(row.tags_enc as Buffer, key)),
    pinned: row.pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: Request) {
  try {
    const session = await requireVaultSession();
    const params = new URL(request.url).searchParams;
    const hasPagination = params.has("limit") || params.has("offset");
    if (!hasPagination) {
      // Retain the historical full response for existing API consumers.
      const result = await queryAsUser(session.userId, 
        `SELECT n.*, t.title_enc AS topic_title_enc
         FROM notes n JOIN topics t ON t.id = n.topic_id
         WHERE n.deleted_at IS NULL
         ORDER BY n.pinned DESC, n.updated_at DESC, n.id DESC`,
      );
      return NextResponse.json({ notes: result.rows.map((row) => serializeNote(row, session.key)) });
    }

    const limit = parseBoundedInteger(params.get("limit"), 50, 1, 100);
    const offset = parseBoundedInteger(params.get("offset"), 0, 0, 1_000_000);
    const [countResult, pageResult] = await Promise.all([
      queryAsUser(session.userId, "SELECT COUNT(*)::int AS total FROM notes WHERE deleted_at IS NULL"),
      queryAsUser(session.userId, 
        `SELECT n.id, n.topic_id, n.title_enc, n.subject_enc, n.content_enc, n.tags_enc,
                n.pinned, n.created_at, n.updated_at, t.title_enc AS topic_title_enc
         FROM notes n JOIN topics t ON t.id = n.topic_id
         WHERE n.deleted_at IS NULL
         ORDER BY n.pinned DESC, n.updated_at DESC, n.id DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
    ]);
    const notes = pageResult.rows.map((row) => serializeNote(row, session.key));
    const total = Number(countResult.rows[0]?.total ?? 0);
    return NextResponse.json({
      notes,
      pagination: { total, offset, limit, hasMore: offset + notes.length < total },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireVaultSession();
    const body = await readJsonObject(request, 8_500_000);
    const topicId = stringField(body, "topicId", 64, true);
    const title = stringField(body, "title", 180, true);
    const subject = stringField(body, "subject", 180);
    const contentValue = body.content && typeof body.content === "object" && !Array.isArray(body.content) ? body.content : { type: "doc", content: [{ type: "paragraph" }] };
    if ((contentValue as { type?: string }).type !== "doc") throw new Error("VALIDATION:Note content is invalid.");
    const content = JSON.stringify(contentValue);
    if (content.length > 2_000_000) throw new Error("VALIDATION:This note is too large.");
    const tags = Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 30) : [];
    const pinned = typeof body.pinned === "boolean" ? body.pinned : false;
    const topic = await queryAsUser(session.userId, "SELECT id FROM topics WHERE id=$1", [topicId]);
    if (!topic.rows[0]) throw new Error("VALIDATION:Choose a valid topic.");
    const result = await queryAsUser(session.userId, 
      `INSERT INTO notes (topic_id, title_enc, subject_enc, content_enc, tags_enc, pinned)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at, updated_at`,
      [topicId, encryptText(title, session.key), encryptText(subject, session.key), encryptText(content, session.key), encryptText(JSON.stringify(tags), session.key), pinned],
    );
    return NextResponse.json({ note: { id: result.rows[0].id, topicId, title, subject, content: JSON.parse(content), tags, pinned, createdAt: result.rows[0].created_at, updatedAt: result.rows[0].updated_at } }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
