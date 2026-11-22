import { NextResponse } from "next/server";
import { requireVaultSession, assertSameOrigin } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText, encryptText } from "@/lib/crypto";
import { deleteAssetsFor } from "@/lib/storage";
import { apiError, requireJsonObject, stringField } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const session = await requireVaultSession();
    const { id } = await context.params;
    const result = await db.query("SELECT * FROM topics WHERE id = $1", [id]);
    if (!result.rows[0]) throw new Error("NOT_FOUND");
    const row = result.rows[0];
    const notesResult = await db.query("SELECT * FROM notes WHERE topic_id = $1 AND deleted_at IS NULL ORDER BY pinned DESC, updated_at DESC", [id]);
    const notes = notesResult.rows.map((note) => ({
      id: note.id,
      title: decryptText(note.title_enc, session.key),
      subject: decryptText(note.subject_enc, session.key),
      content: JSON.parse(decryptText(note.content_enc, session.key)),
      tags: JSON.parse(decryptText(note.tags_enc, session.key)),
      pinned: note.pinned,
      createdAt: note.created_at,
      updatedAt: note.updated_at,
    }));
    return NextResponse.json({
      topic: { id: row.id, title: decryptText(row.title_enc, session.key), subject: decryptText(row.subject_enc, session.key), description: decryptText(row.description_enc, session.key), category: decryptText(row.category_enc, session.key), coverUrl: row.cover_asset_id ? `/api/assets/${row.cover_asset_id}` : null, createdAt: row.created_at, updatedAt: row.updated_at },
      notes,
    });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const session = await requireVaultSession();
    const { id } = await context.params;
    const body = requireJsonObject(await request.json());
    const existing = await db.query("SELECT id FROM topics WHERE id = $1", [id]);
    if (!existing.rows[0]) throw new Error("NOT_FOUND");
    const title = stringField(body, "title", 120, true);
    const subject = stringField(body, "subject", 120);
    const description = stringField(body, "description", 1000);
    const category = stringField(body, "category", 60);
    await db.query(
      `UPDATE topics SET title_enc=$1, subject_enc=$2, description_enc=$3, category_enc=$4, updated_at=NOW() WHERE id=$5`,
      [encryptText(title, session.key), encryptText(subject, session.key), encryptText(description, session.key), encryptText(category, session.key), id],
    );
    return NextResponse.json({ success: true });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    await requireVaultSession();
    const { id } = await context.params;
    const count = await db.query("SELECT COUNT(*)::int AS count FROM notes WHERE topic_id = $1", [id]);
    if (Number(count.rows[0]?.count ?? 0) > 0) throw new Error("CONFLICT");
    const exists = await db.query("SELECT id FROM topics WHERE id = $1", [id]);
    if (!exists.rows[0]) throw new Error("NOT_FOUND");
    await deleteAssetsFor("topic", id);
    await db.query("DELETE FROM topics WHERE id = $1", [id]);
    return NextResponse.json({ success: true });
  } catch (error) { return apiError(error); }
}
