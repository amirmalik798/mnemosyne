import { NextResponse } from "next/server";
import { requireVaultSession, assertSameOrigin } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText, encryptText } from "@/lib/crypto";
import { apiError, requireJsonObject, stringField } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireVaultSession();
    const result = await db.query(
      `SELECT t.*, (SELECT COUNT(*)::int FROM notes n WHERE n.topic_id = t.id AND n.deleted_at IS NULL) AS note_count
       FROM topics t ORDER BY t.updated_at DESC`,
    );
    const topics = result.rows.map((row) => ({
      id: row.id,
      title: decryptText(row.title_enc, session.key),
      subject: decryptText(row.subject_enc, session.key),
      description: decryptText(row.description_enc, session.key),
      category: decryptText(row.category_enc, session.key),
      coverUrl: row.cover_asset_id ? `/api/assets/${row.cover_asset_id}` : null,
      noteCount: row.note_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    return NextResponse.json({ topics });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireVaultSession();
    const body = requireJsonObject(await request.json());
    const title = stringField(body, "title", 120, true);
    const subject = stringField(body, "subject", 120);
    const description = stringField(body, "description", 1000);
    const category = stringField(body, "category", 60);
    const result = await db.query(
      `INSERT INTO topics (title_enc, subject_enc, description_enc, category_enc)
       VALUES ($1, $2, $3, $4) RETURNING id, created_at, updated_at`,
      [encryptText(title, session.key), encryptText(subject, session.key), encryptText(description, session.key), encryptText(category, session.key)],
    );
    return NextResponse.json({ topic: { id: result.rows[0].id, title, subject, description, category, noteCount: 0, coverUrl: null, createdAt: result.rows[0].created_at, updatedAt: result.rows[0].updated_at } }, { status: 201 });
  } catch (error) { return apiError(error); }
}
