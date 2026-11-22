import { NextResponse } from "next/server";
import { assertSameOrigin, requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { deleteAssetsFor } from "@/lib/storage";
import { apiError, requireJsonObject, stringField } from "@/lib/http";

export async function GET() {
  try {
    const session = await requireVaultSession();
    const result = await db.query("SELECT n.*, t.title_enc AS topic_title_enc FROM notes n JOIN topics t ON t.id=n.topic_id WHERE n.deleted_at IS NOT NULL ORDER BY n.deleted_at DESC");
    const notes = result.rows.map((row) => ({
      id: row.id, topicId: row.topic_id, title: decryptText(row.title_enc, session.key),
      subject: decryptText(row.subject_enc, session.key), topicTitle: decryptText(row.topic_title_enc, session.key),
      deletedAt: row.deleted_at,
    }));
    return NextResponse.json({ notes });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireVaultSession();
    const body = requireJsonObject(await request.json());
    const id = stringField(body, "id", 64, true);
    const action = stringField(body, "action", 20, true);
    const exists = await db.query("SELECT id FROM notes WHERE id=$1 AND deleted_at IS NOT NULL", [id]);
    if (!exists.rows[0]) throw new Error("NOT_FOUND");
    if (action === "restore") {
      await db.query("UPDATE notes SET deleted_at=NULL, updated_at=NOW() WHERE id=$1", [id]);
    } else if (action === "delete") {
      await deleteAssetsFor("note", id);
      await db.query("DELETE FROM notes WHERE id=$1", [id]);
    } else throw new Error("VALIDATION:Choose a valid trash action.");
    return NextResponse.json({ success: true });
  } catch (error) { return apiError(error); }
}
