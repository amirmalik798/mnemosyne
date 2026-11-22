import { NextResponse } from "next/server";
import { assertSameOrigin, requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText, encryptText } from "@/lib/crypto";
import { apiError, requireJsonObject, stringField } from "@/lib/http";

export async function GET() {
  try {
    const session = await requireVaultSession();
    const result = await db.query(
      `SELECT n.*, t.title_enc AS topic_title_enc FROM notes n JOIN topics t ON t.id=n.topic_id
       WHERE n.deleted_at IS NULL ORDER BY n.pinned DESC, n.updated_at DESC`,
    );
    const notes = result.rows.map((row) => ({
      id: row.id, topicId: row.topic_id, topicTitle: decryptText(row.topic_title_enc, session.key),
      title: decryptText(row.title_enc, session.key), subject: decryptText(row.subject_enc, session.key),
      content: JSON.parse(decryptText(row.content_enc, session.key)), tags: JSON.parse(decryptText(row.tags_enc, session.key)),
      pinned: row.pinned, createdAt: row.created_at, updatedAt: row.updated_at,
    }));
    return NextResponse.json({ notes });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireVaultSession();
    const body = requireJsonObject(await request.json());
    const topicId = stringField(body, "topicId", 64, true);
    const title = stringField(body, "title", 180, true);
    const subject = stringField(body, "subject", 180);
    const contentValue = body.content && typeof body.content === "object" && !Array.isArray(body.content) ? body.content : { type: "doc", content: [{ type: "paragraph" }] };
    if ((contentValue as { type?: string }).type !== "doc") throw new Error("VALIDATION:Note content is invalid.");
    const content = JSON.stringify(contentValue);
    if (content.length > 2_000_000) throw new Error("VALIDATION:This note is too large.");
    const tags = Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 30) : [];
    const pinned = typeof body.pinned === "boolean" ? body.pinned : false;
    const topic = await db.query("SELECT id FROM topics WHERE id=$1", [topicId]);
    if (!topic.rows[0]) throw new Error("VALIDATION:Choose a valid topic.");
    const result = await db.query(
      `INSERT INTO notes (topic_id, title_enc, subject_enc, content_enc, tags_enc, pinned)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at, updated_at`,
      [topicId, encryptText(title, session.key), encryptText(subject, session.key), encryptText(content, session.key), encryptText(JSON.stringify(tags), session.key), pinned],
    );
    return NextResponse.json({ note: { id: result.rows[0].id, topicId, title, subject, content: JSON.parse(content), tags, pinned, createdAt: result.rows[0].created_at, updatedAt: result.rows[0].updated_at } }, { status: 201 });
  } catch (error) { return apiError(error); }
}
