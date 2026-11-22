import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { assertSameOrigin, requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { detectImageMime, saveEncryptedAsset } from "@/lib/storage";
import { apiError, readBoundedFormData } from "@/lib/http";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  let client: PoolClient | undefined;
  let savedAssetId: string | undefined;
  let commitAttempted = false;

  try {
    assertSameOrigin(request);
    const session = await requireVaultSession();
    const { id } = await context.params;
    const form = await readBoundedFormData(request, 20 * 1024 * 1024 + 256 * 1024);
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("VALIDATION:Choose an image file.");
    if (file.size > 20 * 1024 * 1024) throw new Error("VALIDATION:Images must be 20 MB or smaller.");
    const bytes = Buffer.from(await file.arrayBuffer());
    const mime = detectImageMime(bytes);
    if (!mime) throw new Error("VALIDATION:The file is not a valid PNG, JPEG, WebP or GIF image.");

    // Serialize uploads with note deletion and other note mutations. Asset
    // metadata and its encrypted database blob share this transaction.
    client = await db.connect();
    await client.query("BEGIN");
    const note = await client.query(
      "SELECT id FROM notes WHERE id = $1 AND deleted_at IS NULL FOR NO KEY UPDATE",
      [id],
    );
    if (!note.rows[0]) throw new Error("NOT_FOUND");

    const saved = await saveEncryptedAsset({
      bytes,
      name: file.name.slice(0, 200),
      mimeType: mime,
      ownerType: "note",
      ownerId: id,
      key: session.key,
      query: (text, values) => client!.query(text, values),
    });
    savedAssetId = saved.id;

    commitAttempted = true;
    await client.query("COMMIT");
    return NextResponse.json({
      asset: {
        id: saved.id,
        url: `/api/assets/${saved.id}`,
        mimeType: saved.mimeType,
        byteSize: saved.byteSize,
      },
    }, { status: 201 });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    if (commitAttempted) {
      console.error("[Mnemosyne] Note image upload commit outcome is uncertain; metadata and encrypted blob are in one database transaction.", {
        assetId: savedAssetId,
      });
    }
    return apiError(error);
  } finally {
    client?.release();
  }
}
