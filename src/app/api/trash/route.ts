import { NextResponse } from "next/server";
import { assertSameOrigin, requireVaultSession } from "@/lib/auth";
import { db, queryAsUser } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { deleteTrashedNoteWithAssets } from "@/lib/storage";
import { apiError, readJsonObject, stringField } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const session = await requireVaultSession();
    const params = new URL(request.url).searchParams;
    const paginated = params.has("limit") || params.has("offset");
    const requestedLimit = Number(params.get("limit") ?? 50);
    const requestedOffset = Number(params.get("offset") ?? 0);
    const limit = Number.isSafeInteger(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50;
    const offset = Number.isSafeInteger(requestedOffset) ? Math.min(1_000_000, Math.max(0, requestedOffset)) : 0;

    const [countResult, pageResult] = paginated
      ? await Promise.all([
          queryAsUser(session.userId, "SELECT COUNT(*)::int AS total FROM notes WHERE deleted_at IS NOT NULL"),
          queryAsUser(session.userId, 
            `SELECT n.id, n.topic_id, n.title_enc, n.subject_enc, n.deleted_at,
                    t.title_enc AS topic_title_enc
             FROM notes n
             JOIN topics t ON t.id = n.topic_id
             WHERE n.deleted_at IS NOT NULL
             ORDER BY n.deleted_at DESC, n.id DESC
             LIMIT $1 OFFSET $2`,
            [limit, offset],
          ),
        ])
      : [null, await queryAsUser(session.userId, 
          `SELECT n.id, n.topic_id, n.title_enc, n.subject_enc, n.deleted_at,
                  t.title_enc AS topic_title_enc
           FROM notes n
           JOIN topics t ON t.id = n.topic_id
           WHERE n.deleted_at IS NOT NULL
           ORDER BY n.deleted_at DESC, n.id DESC`,
        )];

    const notes = pageResult.rows.map((row) => ({
      id: row.id,
      topicId: row.topic_id,
      title: decryptText(row.title_enc, session.key),
      subject: decryptText(row.subject_enc, session.key),
      topicTitle: decryptText(row.topic_title_enc, session.key),
      deletedAt: row.deleted_at,
    }));
    if (!paginated) return NextResponse.json({ notes });

    const total = Number(countResult?.rows[0]?.total ?? 0);
    return NextResponse.json({
      notes,
      pagination: {
        total,
        offset,
        limit,
        hasMore: offset + notes.length < total,
      },
    });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireVaultSession();
    const body = await readJsonObject(request, 16 * 1024);
    const id = stringField(body, "id", 64, true);
    const action = stringField(body, "action", 20, true);
    if (action === "restore") {
      const restored = await queryAsUser(session.userId, 
        "UPDATE notes SET deleted_at = NULL, updated_at = NOW() WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id",
        [id],
      );
      if (!restored.rows[0]) throw new Error("NOT_FOUND");
    } else if (action === "delete") {
      await deleteTrashedNoteWithAssets(id, session.userId);
    } else {
      throw new Error("VALIDATION:Choose a valid trash action.");
    }
    return NextResponse.json({ success: true });
  } catch (error) { return apiError(error); }
}
