import { NextResponse } from "next/server";
import { assertSameOrigin, requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { detectImageMime, saveEncryptedAsset, deleteAssetById } from "@/lib/storage";
import { apiError } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const session = await requireVaultSession();
    const { id } = await context.params;
    const topic = await db.query("SELECT cover_asset_id FROM topics WHERE id = $1", [id]);
    if (!topic.rows[0]) throw new Error("NOT_FOUND");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("VALIDATION:Choose an image file.");
    if (file.size > 8 * 1024 * 1024) throw new Error("VALIDATION:Topic covers must be 8 MB or smaller.");
    const bytes = Buffer.from(await file.arrayBuffer());
    const mime = detectImageMime(bytes);
    if (!mime) throw new Error("VALIDATION:Use a PNG, JPEG, WebP or GIF image.");
    const saved = await saveEncryptedAsset({ bytes, name: file.name.slice(0, 200), mimeType: mime, ownerType: "topic", ownerId: id, key: session.key });
    await db.query("UPDATE topics SET cover_asset_id = $1, updated_at = NOW() WHERE id = $2", [saved.id, id]);
    if (topic.rows[0].cover_asset_id) await deleteAssetById(topic.rows[0].cover_asset_id);
    return NextResponse.json({ coverUrl: `/api/assets/${saved.id}` });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    await requireVaultSession();
    const { id } = await context.params;
    const result = await db.query("SELECT cover_asset_id FROM topics WHERE id=$1", [id]);
    if (!result.rows[0]) throw new Error("NOT_FOUND");
    const currentId = result.rows[0].cover_asset_id as string | null;
    await db.query("UPDATE topics SET cover_asset_id=NULL, updated_at=NOW() WHERE id=$1", [id]);
    if (currentId) await deleteAssetById(currentId);
    return NextResponse.json({ success: true });
  } catch (error) { return apiError(error); }
}
