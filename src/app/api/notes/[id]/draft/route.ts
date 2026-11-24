import { NextResponse } from "next/server";
import { assertSameOrigin, requireVaultSession } from "@/lib/auth";
import { queryAsUser } from "@/lib/db";
import { decryptText, encryptText } from "@/lib/crypto";
import { apiError, readJsonObject, stringField } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function timestampIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function serializeDraft(row: Record<string, unknown>, key: Buffer) {
  return {
    topicId: row.topic_id,
    title: decryptText(row.title_enc as Buffer, key),
    subject: decryptText(row.subject_enc as Buffer, key),
    content: JSON.parse(decryptText(row.content_enc as Buffer, key)),
    tags: JSON.parse(decryptText(row.tags_enc as Buffer, key)),
    pinned: Boolean(row.pinned),
    baseNoteUpdatedAt: timestampIso(row.base_note_updated_at),
    updatedAt: timestampIso(row.updated_at),
    noteUpdatedAt: timestampIso(row.note_updated_at),
  };
}

export async function GET(_request: Request, context: Context) {
  try {
    const session = await requireVaultSession();
    const { id } = await context.params;
    const result = await queryAsUser(session.userId,
      `SELECT d.note_id, d.topic_id, d.title_enc, d.subject_enc, d.content_enc,
              d.tags_enc, d.pinned, d.base_note_updated_at, d.updated_at,
              n.updated_at AS note_updated_at
       FROM note_drafts d
       JOIN notes n ON n.id = d.note_id AND n.deleted_at IS NULL
       WHERE d.note_id = $1`,
      [id],
    );
    if (!result.rows[0]) return NextResponse.json({ draft: null }, { headers: { "Cache-Control": "no-store" } });
    const draft = serializeDraft(result.rows[0], session.key);
    const conflict = new Date(draft.noteUpdatedAt).getTime() !== new Date(draft.baseNoteUpdatedAt).getTime();
    return NextResponse.json({ draft, conflict }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const session = await requireVaultSession();
    const { id } = await context.params;
    const body = await readJsonObject(request, 8_500_000);
    const topicId = stringField(body, "topicId", 64, true);
    const title = stringField(body, "title", 180, true);
    const subject = stringField(body, "subject", 180);
    const baseNoteUpdatedAt = stringField(body, "baseNoteUpdatedAt", 64, true);
    const baseDate = new Date(baseNoteUpdatedAt);
    if (Number.isNaN(baseDate.getTime())) throw new Error("VALIDATION:The recovery snapshot has an invalid base revision.");
    const contentValue = body.content && typeof body.content === "object" && !Array.isArray(body.content)
      ? body.content : { type: "doc", content: [{ type: "paragraph" }] };
    if ((contentValue as { type?: string }).type !== "doc") throw new Error("VALIDATION:Note content is invalid.");
    const content = JSON.stringify(contentValue);
    if (content.length > 2_000_000) throw new Error("VALIDATION:This note is too large.");
    const tags = Array.isArray(body.tags)
      ? body.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 30)
      : [];
    const pinned = typeof body.pinned === "boolean" ? body.pinned : false;

    const result = await queryAsUser(session.userId,
      `INSERT INTO note_drafts
         (note_id, user_id, topic_id, title_enc, subject_enc, content_enc, tags_enc,
          pinned, base_note_updated_at, created_at, updated_at)
       SELECT n.id, n.user_id, t.id, $3, $4, $5, $6, $7, $8, NOW(), NOW()
       FROM notes n
       JOIN topics t ON t.id = $2 AND t.user_id = n.user_id
       WHERE n.id = $1 AND n.deleted_at IS NULL
       ON CONFLICT (note_id) DO UPDATE SET
         topic_id = EXCLUDED.topic_id,
         title_enc = EXCLUDED.title_enc,
         subject_enc = EXCLUDED.subject_enc,
         content_enc = EXCLUDED.content_enc,
         tags_enc = EXCLUDED.tags_enc,
         pinned = EXCLUDED.pinned,
         base_note_updated_at = EXCLUDED.base_note_updated_at,
         updated_at = NOW()
       RETURNING note_id`,
      [id, topicId, encryptText(title, session.key), encryptText(subject, session.key),
       encryptText(content, session.key), encryptText(JSON.stringify(tags), session.key), pinned, baseDate],
    );
    if (!result.rows[0]) throw new Error("NOT_FOUND");
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const session = await requireVaultSession();
    const { id } = await context.params;
    await queryAsUser(session.userId, "DELETE FROM note_drafts WHERE note_id = $1", [id]);
    return NextResponse.json({ success: true });
  } catch (error) { return apiError(error); }
}
