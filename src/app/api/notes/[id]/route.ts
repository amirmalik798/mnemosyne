import { NextResponse } from "next/server";
import { assertSameOrigin, requireVaultSession } from "@/lib/auth";
import { queryAsUser } from "@/lib/db";
import { decryptText, encryptText } from "@/lib/crypto";
import { updateNoteAndCleanupAssets } from "@/lib/storage";
import { apiError, readJsonObject, stringField } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const session = await requireVaultSession();
    const { id } = await context.params;
    const result = await queryAsUser(session.userId, 
      `SELECT n.id, n.topic_id, n.title_enc, n.subject_enc, n.content_enc, n.tags_enc, n.pinned, n.created_at, n.updated_at, t.title_enc AS topic_title_enc FROM notes n JOIN topics t ON t.id=n.topic_id WHERE n.id=$1 AND n.deleted_at IS NULL`, [id],
    );
    if (!result.rows[0]) throw new Error("NOT_FOUND");
    const row = result.rows[0];
    return NextResponse.json({ note: {
      id: row.id, topicId: row.topic_id, topicTitle: decryptText(row.topic_title_enc, session.key),
      title: decryptText(row.title_enc, session.key), subject: decryptText(row.subject_enc, session.key),
      content: JSON.parse(decryptText(row.content_enc, session.key)), tags: JSON.parse(decryptText(row.tags_enc, session.key)),
      pinned: row.pinned, createdAt: row.created_at, updatedAt: row.updated_at,
    } });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const session = await requireVaultSession();
    const { id } = await context.params;
    const body = await readJsonObject(request, 8_500_000);
    const title = stringField(body, "title", 180, true);
    const subject = stringField(body, "subject", 180);
    const topicId = stringField(body, "topicId", 64, true);
    const contentValue = body.content && typeof body.content === "object" && !Array.isArray(body.content) ? body.content : { type: "doc", content: [{ type: "paragraph" }] };
    if ((contentValue as { type?: string }).type !== "doc") throw new Error("VALIDATION:Note content is invalid.");
    const content = JSON.stringify(contentValue);
    if (content.length > 2_000_000) throw new Error("VALIDATION:This note is too large.");
    const tags = Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 30) : [];
    const pinned = typeof body.pinned === "boolean" ? body.pinned : false;

    await updateNoteAndCleanupAssets({
      userId: session.userId,
      noteId: id,
      topicId,
      titleEnc: encryptText(title, session.key),
      subjectEnc: encryptText(subject, session.key),
      contentEnc: encryptText(content, session.key),
      tagsEnc: encryptText(JSON.stringify(tags), session.key),
      pinned,
      content: contentValue,
    });
    return NextResponse.json({ success: true });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const session = await requireVaultSession();
    const { id } = await context.params;
    const result = await queryAsUser(session.userId,
      `WITH deleted_note AS (
         UPDATE notes
         SET deleted_at=NOW(), updated_at=NOW()
         WHERE id=$1 AND deleted_at IS NULL
         RETURNING id, topic_id
       ),
       touched_topic AS (
         UPDATE topics t
         SET updated_at=NOW()
         FROM deleted_note n
         WHERE t.id=n.topic_id
         RETURNING t.id
       )
       SELECT n.id
       FROM deleted_note n
       JOIN touched_topic t ON t.id=n.topic_id`,
      [id],
    );
    if (!result.rows[0]) throw new Error("NOT_FOUND");
    return NextResponse.json({ success: true });
  } catch (error) { return apiError(error); }
}
