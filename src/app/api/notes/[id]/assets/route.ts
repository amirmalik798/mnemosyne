import { NextResponse } from "next/server";
import { assertSameOrigin, requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { detectImageMime, saveEncryptedAsset } from "@/lib/storage";
import { apiError } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const session = await requireVaultSession();
    const { id } = await context.params;
    const note = await db.query("SELECT id FROM notes WHERE id=$1 AND deleted_at IS NULL", [id]);
    if (!note.rows[0]) throw new Error("NOT_FOUND");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("VALIDATION:Choose an image file.");
    if (file.size > 20 * 1024 * 1024) throw new Error("VALIDATION:Images must be 20 MB or smaller.");
    const bytes = Buffer.from(await file.arrayBuffer());
    const mime = detectImageMime(bytes);
    if (!mime) throw new Error("VALIDATION:Use a PNG, JPEG, WebP or GIF image.");
    const saved = await saveEncryptedAsset({ bytes, name: file.name.slice(0, 200), mimeType: mime, ownerType: "note", ownerId: id, key: session.key });
    return NextResponse.json({ asset: { id: saved.id, url: `/api/assets/${saved.id}`, mimeType: saved.mimeType, byteSize: saved.byteSize } }, { status: 201 });
  } catch (error) { return apiError(error); }
}
