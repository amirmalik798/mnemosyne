import { NextResponse } from "next/server";
import { requireVaultSession, assertSameOrigin } from "@/lib/auth";
import { queryAsUser } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { readVerifiedImageAsset, deleteAssetById } from "@/lib/storage";
import { apiError } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const session = await requireVaultSession();
    const { id } = await context.params;
    const result = await queryAsUser(session.userId, 
      `SELECT a.id, a.storage_key, a.original_name_enc, a.mime_type, a.byte_size,
              b.encrypted_bytes
       FROM assets a
       LEFT JOIN asset_blobs b ON b.asset_id = a.id
       WHERE a.id = $1`,
      [id],
    );
    if (!result.rows[0]) throw new Error("NOT_FOUND");
    const asset = result.rows[0];
    const bytes = await readVerifiedImageAsset({
      encryptedBytes: asset.encrypted_bytes as Buffer | null,
      storageKey: asset.storage_key as string | null,
      key: session.key,
      mimeType: asset.mime_type,
      byteSize: asset.byte_size,
    });
    const filename = decryptText(asset.original_name_enc, session.key).replace(/[\r\n"\\]/g, "_");
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": asset.mime_type,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const session = await requireVaultSession();
    const { id } = await context.params;
    const result = await queryAsUser(session.userId, "SELECT id FROM assets WHERE id=$1", [id]);
    if (!result.rows[0]) throw new Error("NOT_FOUND");
    await deleteAssetById(id, session.key, session.userId);
    return NextResponse.json({ success: true });
  } catch (error) { return apiError(error); }
}
