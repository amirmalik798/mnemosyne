import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { assertSameOrigin, requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { detectImageMime, removeEncryptedStorageFile, saveEncryptedAsset } from "@/lib/storage";
import { apiError, readBoundedFormData } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  let client: PoolClient | undefined;
  let savedStorageKey: string | undefined;
  let oldStorageKey: string | undefined;
  let commitAttempted = false;

  try {
    assertSameOrigin(request);
    const session = await requireVaultSession();
    const { id } = await context.params;
    const form = await readBoundedFormData(request, 8 * 1024 * 1024 + 256 * 1024);
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("VALIDATION:Choose an image file.");
    if (file.size > 8 * 1024 * 1024) throw new Error("VALIDATION:Topic covers must be 8 MB or smaller.");
    const bytes = Buffer.from(await file.arrayBuffer());
    const mime = detectImageMime(bytes);
    if (!mime) throw new Error("VALIDATION:Use a PNG, JPEG, WebP or GIF image.");

    client = await db.connect();
    await client.query("BEGIN");
    const topic = await client.query(
      "SELECT cover_asset_id FROM topics WHERE id = $1 FOR NO KEY UPDATE",
      [id],
    );
    if (!topic.rows[0]) throw new Error("NOT_FOUND");

    const saved = await saveEncryptedAsset({
      bytes,
      name: file.name.slice(0, 200),
      mimeType: mime,
      ownerType: "topic",
      ownerId: id,
      key: session.key,
      query: (text, values) => client!.query(text, values),
    });
    savedStorageKey = saved.storageKey;

    await client.query(
      "UPDATE topics SET cover_asset_id = $1, updated_at = NOW() WHERE id = $2",
      [saved.id, id],
    );

    const previousCoverId = topic.rows[0].cover_asset_id as string | null;
    if (previousCoverId) {
      const removed = await client.query(
        "DELETE FROM assets WHERE id = $1 AND owner_type = 'topic' AND owner_id = $2 RETURNING storage_key",
        [previousCoverId, id],
      );
      oldStorageKey = removed.rows[0]?.storage_key as string | undefined;
    }

    commitAttempted = true;
    await client.query("COMMIT");
    if (oldStorageKey) await removeEncryptedStorageFile(oldStorageKey);
    return NextResponse.json({ coverUrl: `/api/assets/${saved.id}` });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    if (savedStorageKey && !commitAttempted) {
      await removeEncryptedStorageFile(savedStorageKey);
    } else if (savedStorageKey && commitAttempted) {
      console.error("[Mnemosyne] Topic-cover replacement commit outcome is uncertain; encrypted files were retained.", {
        newStorageKey: savedStorageKey,
        oldStorageKey,
      });
    }
    return apiError(error);
  } finally {
    client?.release();
  }
}

export async function DELETE(request: Request, context: Context) {
  let client: PoolClient | undefined;
  let oldStorageKey: string | undefined;
  let commitAttempted = false;

  try {
    assertSameOrigin(request);
    await requireVaultSession();
    const { id } = await context.params;
    client = await db.connect();
    await client.query("BEGIN");

    const result = await client.query(
      "SELECT cover_asset_id FROM topics WHERE id = $1 FOR NO KEY UPDATE",
      [id],
    );
    if (!result.rows[0]) throw new Error("NOT_FOUND");
    const currentId = result.rows[0].cover_asset_id as string | null;
    await client.query(
      "UPDATE topics SET cover_asset_id = NULL, updated_at = NOW() WHERE id = $1",
      [id],
    );
    if (currentId) {
      const removed = await client.query(
        "DELETE FROM assets WHERE id = $1 AND owner_type = 'topic' AND owner_id = $2 RETURNING storage_key",
        [currentId, id],
      );
      oldStorageKey = removed.rows[0]?.storage_key as string | undefined;
    }

    commitAttempted = true;
    await client.query("COMMIT");
    if (oldStorageKey) await removeEncryptedStorageFile(oldStorageKey);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    if (commitAttempted && oldStorageKey) {
      console.error("[Mnemosyne] Topic-cover deletion commit outcome is uncertain; encrypted file was retained.", {
        storageKey: oldStorageKey,
      });
    }
    return apiError(error);
  } finally {
    client?.release();
  }
}
