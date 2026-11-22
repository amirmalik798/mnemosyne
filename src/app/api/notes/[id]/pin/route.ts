import { NextResponse } from "next/server";
import { assertSameOrigin, requireVaultSession } from "@/lib/auth";
import { queryAsUser } from "@/lib/db";
import { apiError, readJsonObject } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const session = await requireVaultSession();
    const { id } = await context.params;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(id)) throw new Error("NOT_FOUND");

    const body = await readJsonObject(request, 4096);
    if (typeof body.pinned !== "boolean") {
      throw new Error("VALIDATION:Choose whether this note should be pinned.");
    }

    const result = await queryAsUser(
      session.userId,
      "UPDATE notes SET pinned=$1, updated_at=NOW() WHERE id=$2 AND deleted_at IS NULL RETURNING id, pinned",
      [body.pinned, id],
    );
    if (!result.rows[0]) throw new Error("NOT_FOUND");

    return NextResponse.json({ success: true, noteId: result.rows[0].id, pinned: result.rows[0].pinned });
  } catch (error) {
    return apiError(error);
  }
}
