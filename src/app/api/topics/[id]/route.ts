import { NextResponse } from "next/server";
import { requireVaultSession, assertSameOrigin } from "@/lib/auth";
import { queryAsUser } from "@/lib/db";
import { decryptText, encryptText } from "@/lib/crypto";
import { deleteEmptyTopicWithAssets } from "@/lib/storage";
import { apiError, readJsonObject, stringField } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const session = await requireVaultSession();
    const { id } = await context.params;
    const [result, notesResult] = await Promise.all([
      queryAsUser(session.userId, "SELECT id, title_enc, subject_enc, description_enc, category_enc, cover_asset_id, created_at, updated_at FROM topics WHERE id = $1", [id]),
      queryAsUser(session.userId, 
        "SELECT id, title_enc, subject_enc, content_enc, tags_enc, pinned, created_at, updated_at FROM notes WHERE topic_id = $1 AND deleted_at IS NULL ORDER BY pinned DESC, updated_at DESC, id DESC",
        [id],
      ),
    ]);
    if (!result.rows[0]) throw new Error("NOT_FOUND");

    const row = result.rows[0];
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
      topic: {
        id: row.id,
        title: decryptText(row.title_enc, session.key),
        subject: decryptText(row.subject_enc, session.key),
        description: decryptText(row.description_enc, session.key),
        category: decryptText(row.category_enc, session.key),
        coverUrl: row.cover_asset_id ? `/api/assets/${row.cover_asset_id}` : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
      notes,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const session = await requireVaultSession();
    const { id } = await context.params;
    const body = await readJsonObject(request, 16 * 1024);
    const existing = await queryAsUser(session.userId, "SELECT id FROM topics WHERE id = $1", [id]);
    if (!existing.rows[0]) throw new Error("NOT_FOUND");
    const title = stringField(body, "title", 120, true);
    const subject = stringField(body, "subject", 120);
    const description = stringField(body, "description", 1000);
    const category = stringField(body, "category", 60);
    await queryAsUser(session.userId, 
      `UPDATE topics SET title_enc=$1, subject_enc=$2, description_enc=$3, category_enc=$4, updated_at=NOW() WHERE id=$5`,
      [encryptText(title, session.key), encryptText(subject, session.key), encryptText(description, session.key), encryptText(category, session.key), id],
    );
    return NextResponse.json({ success: true });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const session = await requireVaultSession();
    const { id } = await context.params;
    await deleteEmptyTopicWithAssets(id, session.userId);
    return NextResponse.json({ success: true });
  } catch (error) { return apiError(error); }
}
