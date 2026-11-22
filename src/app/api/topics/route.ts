import { NextResponse } from "next/server";
import { requireVaultSession, assertSameOrigin } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText, encryptText } from "@/lib/crypto";
import { apiError, readJsonObject, stringField } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await requireVaultSession();
    const params = new URL(request.url).searchParams;
    const hasPagination = params.has("limit") || params.has("offset");
    if (!hasPagination) {
      // Keep the legacy unpaginated contract for existing clients.
      const result = await db.query(
        `SELECT t.*, (SELECT COUNT(*)::int FROM notes n
         WHERE n.topic_id = t.id AND n.deleted_at IS NULL) AS note_count
         FROM topics t ORDER BY t.updated_at DESC, t.id DESC`,
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
    }

    const parseBoundedInteger = (value: string | null, fallback: number, minimum: number, maximum: number) => {
      if (value === null) return fallback;
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
    };
    const limit = parseBoundedInteger(params.get("limit"), 50, 1, 100);
    const offset = parseBoundedInteger(params.get("offset"), 0, 0, 1_000_000);
    const [countResult, pageResult] = await Promise.all([
      db.query("SELECT COUNT(*)::int AS total FROM topics"),
      db.query(
        `SELECT t.id, t.title_enc, t.subject_enc, t.description_enc, t.category_enc,
                t.cover_asset_id, t.created_at, t.updated_at,
                (SELECT COUNT(*)::int FROM notes n
                 WHERE n.topic_id = t.id AND n.deleted_at IS NULL) AS note_count
         FROM topics t
         ORDER BY t.updated_at DESC, t.id DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
    ]);
    const topics = pageResult.rows.map((row) => ({
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
    const total = Number(countResult.rows[0]?.total ?? 0);
    return NextResponse.json({
      topics,
      pagination: { total, offset, limit, hasMore: offset + topics.length < total },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireVaultSession();
    const body = await readJsonObject(request, 16 * 1024);
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
  } catch (error) {
    return apiError(error);
  }
}
