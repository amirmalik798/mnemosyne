import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { Pool, type PoolClient } from "pg";
import { createDatabasePoolConfig } from "../src/lib/db-config";

function sqlState(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

async function setAccount(client: PoolClient, userId: string) {
  await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
}

async function main() {
  const appUrl = process.env.APP_DATABASE_URL;
  if (!appUrl) throw new Error("APP_DATABASE_URL is required. Use the restricted Mnemosyne runtime role.");

  const pool = new Pool(createDatabasePoolConfig({ ...process.env, DATABASE_URL: appUrl }, { max: 1 }));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userA = randomUUID();
    const userB = randomUUID();
    const topicA = randomUUID();
    const topicB = randomUUID();
    const noteA = randomUUID();
    const noteForDraft = randomUUID();
    const lifecycleNote = randomUUID();
    const assetA = randomUUID();
    const assetAWithoutBlob = randomUUID();

    for (const [id, suffix] of [[userA, "a"], [userB, "b"]] as const) {
      await client.query(
        "INSERT INTO users (id,email,display_name,password_hash,password_salt,wrapped_key) VALUES ($1,$2,$3,$4,$5,$6)",
        [id, "tenant-test-" + randomUUID() + "@" + suffix + ".example.test", "Isolation test", "not-a-real-password-hash", randomBytes(16), randomBytes(64)],
      );
    }

    await setAccount(client, userA);
    await client.query(
      "INSERT INTO topics (id,title_enc,subject_enc,description_enc,category_enc) VALUES ($1,$2,$2,$2,$2)",
      [topicA, randomBytes(48)],
    );
    await client.query(
      "INSERT INTO notes (id,topic_id,title_enc,subject_enc,content_enc,tags_enc) VALUES ($1,$2,$3,$3,$3,$3)",
      [noteA, topicA, randomBytes(48)],
    );
    await client.query(
      `INSERT INTO note_drafts
       (note_id,user_id,topic_id,title_enc,subject_enc,content_enc,tags_enc,base_note_updated_at)
       VALUES ($1,$2,$3,$4,$4,$4,$4,NOW())`,
      [noteA, userA, topicA, randomBytes(48)],
    );
    await client.query(
      "INSERT INTO notes (id,topic_id,title_enc,subject_enc,content_enc,tags_enc) VALUES ($1,$2,$3,$3,$3,$3)",
      [noteForDraft, topicA, randomBytes(48)],
    );
    await client.query(
      "INSERT INTO assets (id,owner_type,owner_id,original_name_enc,mime_type,byte_size) VALUES ($1,'topic',$2,$3,'image/png',1)",
      [assetA, topicA, randomBytes(48)],
    );
    await client.query(
      "INSERT INTO asset_blobs (asset_id,encrypted_bytes) VALUES ($1,$2)",
      [assetA, randomBytes(29)],
    );
    // Keep a second account-A asset without a blob so the cross-account blob
    // test reaches the composite ownership foreign key rather than the blob
    // table's primary-key constraint.
    await client.query(
      "INSERT INTO assets (id,owner_type,owner_id,original_name_enc,mime_type,byte_size) VALUES ($1,'topic',$2,$3,'image/png',1)",
      [assetAWithoutBlob, topicA, randomBytes(48)],
    );

    // Note lifecycle mutations must keep the parent topic's modified date in
    // sync with the note, so the topic archive's modified sort is reliable.
    const resetTopicTimestamp = async () => {
      await client.query(
        "UPDATE topics SET updated_at=TIMESTAMPTZ '2000-01-01 00:00:00+00' WHERE id=$1",
        [topicA],
      );
    };
    const assertTopicTimestampTouched = async (operation: string) => {
      const timestamp = await client.query("SELECT updated_at FROM topics WHERE id=$1", [topicA]);
      assert.ok(
        new Date(timestamp.rows[0].updated_at).getTime() > Date.parse("2020-01-01T00:00:00Z"),
        "note " + operation + " must update its parent topic timestamp",
      );
    };

    // A client-generated note ID makes create retries idempotent if the
    // server commits but the response is lost before reaching the browser.
    const createWithStableId = () => client.query(
      `WITH inserted AS (
         INSERT INTO notes (id, topic_id, title_enc, subject_enc, content_enc, tags_enc)
         SELECT $1, t.id, $3, $3, $3, $3
         FROM topics t
         WHERE t.id=$2
         ON CONFLICT (id) DO NOTHING
         RETURNING id, topic_id, created_at, updated_at
       ),
       resolved AS (
         SELECT id, topic_id, created_at, updated_at FROM inserted
         UNION ALL
         SELECT n.id, n.topic_id, n.created_at, n.updated_at
         FROM notes n
         WHERE n.id=$1 AND n.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM inserted)
       ),
       touched_topic AS (
         UPDATE topics t SET updated_at=NOW()
         FROM resolved i WHERE t.id=i.topic_id
         RETURNING t.id
       )
       SELECT i.id FROM resolved i JOIN touched_topic t ON t.id=i.topic_id`,
      [lifecycleNote, topicA, randomBytes(48)],
    );
    const createdLifecycleNote = await createWithStableId();
    const retriedLifecycleNote = await createWithStableId();
    assert.equal(createdLifecycleNote.rowCount, 1, "note creation should also touch its topic");
    assert.equal(retriedLifecycleNote.rowCount, 1, "retrying the same note creation should return the existing note");
    assert.equal(retriedLifecycleNote.rows[0].id, createdLifecycleNote.rows[0].id, "an ambiguous create retry must not duplicate a note");
    await assertTopicTimestampTouched("creation");

    await resetTopicTimestamp();
    const pinnedLifecycleNote = await client.query(
      `WITH updated_note AS (
         UPDATE notes SET pinned=TRUE, updated_at=NOW()
         WHERE id=$1 AND deleted_at IS NULL
         RETURNING id, topic_id
       ),
       touched_topic AS (
         UPDATE topics t SET updated_at=NOW()
         FROM updated_note n WHERE t.id=n.topic_id
         RETURNING t.id
       )
       SELECT n.id FROM updated_note n JOIN touched_topic t ON t.id=n.topic_id`,
      [lifecycleNote],
    );
    assert.equal(pinnedLifecycleNote.rowCount, 1, "pinning should update the note and its topic");
    await assertTopicTimestampTouched("pinning");

    await client.query(
      `INSERT INTO note_drafts
       (note_id,user_id,topic_id,title_enc,subject_enc,content_enc,tags_enc,base_note_updated_at)
       VALUES ($1,$2,$3,$4,$4,$4,$4,NOW())`,
      [lifecycleNote, userA, topicA, randomBytes(48)],
    );
    await resetTopicTimestamp();
    const trashedLifecycleNote = await client.query(
      `WITH deleted_note AS (
         UPDATE notes SET deleted_at=NOW(), updated_at=NOW()
         WHERE id=$1 AND deleted_at IS NULL
         RETURNING id, topic_id
       ),
       touched_topic AS (
         UPDATE topics t SET updated_at=NOW()
         FROM deleted_note n WHERE t.id=n.topic_id
         RETURNING t.id
       ),
       removed_recovery_draft AS (
         DELETE FROM note_drafts
         WHERE note_id=$1 AND EXISTS (SELECT 1 FROM deleted_note)
         RETURNING note_id
       )
       SELECT n.id FROM deleted_note n JOIN touched_topic t ON t.id=n.topic_id`,
      [lifecycleNote],
    );
    assert.equal(trashedLifecycleNote.rowCount, 1, "moving a note to trash should touch its topic");
    assert.equal(
      (await client.query("SELECT note_id FROM note_drafts WHERE note_id=$1", [lifecycleNote])).rowCount,
      0,
      "moving a note to Trash should discard its stale recovery draft",
    );
    await assertTopicTimestampTouched("trash");

    await resetTopicTimestamp();
    const restoredLifecycleNote = await client.query(
      `WITH restored_note AS (
         UPDATE notes SET deleted_at=NULL, updated_at=NOW()
         WHERE id=$1 AND deleted_at IS NOT NULL
         RETURNING id, topic_id
       ),
       touched_topic AS (
         UPDATE topics t SET updated_at=NOW()
         FROM restored_note n WHERE t.id=n.topic_id
         RETURNING t.id
       )
       SELECT n.id FROM restored_note n JOIN touched_topic t ON t.id=n.topic_id`,
      [lifecycleNote],
    );
    assert.equal(restoredLifecycleNote.rowCount, 1, "restoring a note should touch its topic");
    await assertTopicTimestampTouched("restore");

    // A note must be in Trash before the permanent-delete path can run.
    await client.query(
      "UPDATE notes SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL",
      [lifecycleNote],
    );
    await resetTopicTimestamp();
    const lifecycleParent = await client.query(
      "SELECT id, topic_id FROM notes WHERE id=$1 AND deleted_at IS NOT NULL FOR UPDATE",
      [lifecycleNote],
    );
    assert.equal(lifecycleParent.rowCount, 1, "the note should be in Trash before permanent deletion");
    await client.query("UPDATE topics SET updated_at=NOW() WHERE id=$1", [lifecycleParent.rows[0].topic_id]);
    await client.query("DELETE FROM notes WHERE id=$1 AND deleted_at IS NOT NULL", [lifecycleNote]);
    await assertTopicTimestampTouched("permanent deletion");

    await setAccount(client, userB);
    await client.query(
      "INSERT INTO topics (id,title_enc,subject_enc,description_enc,category_enc) VALUES ($1,$2,$2,$2,$2)",
      [topicB, randomBytes(48)],
    );

    assert.equal((await client.query("SELECT id FROM topics WHERE id=$1", [topicA])).rowCount, 0, "account B must not see account A topics");
    assert.equal((await client.query("SELECT id FROM notes WHERE id=$1", [noteA])).rowCount, 0, "account B must not see account A notes");
    assert.equal((await client.query("SELECT note_id FROM note_drafts WHERE note_id=$1", [noteA])).rowCount, 0, "account B must not see account A recovery drafts");
    assert.equal((await client.query("SELECT id FROM assets WHERE id=$1", [assetA])).rowCount, 0, "account B must not see account A image metadata");
    assert.equal((await client.query("SELECT asset_id FROM asset_blobs WHERE asset_id=$1", [assetA])).rowCount, 0, "account B must not see account A image blobs");

    await client.query("SAVEPOINT cross_account_draft");
    let draftOwnershipCode: string | undefined;
    try {
      await client.query(
        `INSERT INTO note_drafts
         (note_id,user_id,topic_id,title_enc,subject_enc,content_enc,tags_enc,base_note_updated_at)
         VALUES ($1,$2,$3,$4,$4,$4,$4,NOW())`,
        [noteForDraft, userB, topicB, randomBytes(48)],
      );
    } catch (error) {
      draftOwnershipCode = sqlState(error);
      await client.query("ROLLBACK TO SAVEPOINT cross_account_draft");
    }
    assert.ok(draftOwnershipCode === "42501" || draftOwnershipCode === "23503", "a recovery draft must not reference another account's note");

    await client.query("SAVEPOINT cross_account_note");
    let noteRelationCode: string | undefined;
    try {
      await client.query(
        "INSERT INTO notes (topic_id,title_enc,subject_enc,content_enc,tags_enc) VALUES ($1,$2,$2,$2,$2)",
        [topicA, randomBytes(48)],
      );
    } catch (error) {
      noteRelationCode = sqlState(error);
      await client.query("ROLLBACK TO SAVEPOINT cross_account_note");
    }
    assert.equal(noteRelationCode, "23503", "a note must not reference another account's topic");

    await client.query("SAVEPOINT cross_account_asset");
    let assetRelationCode: string | undefined;
    try {
      await client.query(
        "INSERT INTO assets (owner_type,owner_id,original_name_enc,mime_type,byte_size) VALUES ('topic',$1,$2,'image/png',1)",
        [topicA, randomBytes(48)],
      );
    } catch (error) {
      assetRelationCode = sqlState(error);
      await client.query("ROLLBACK TO SAVEPOINT cross_account_asset");
    }
    assert.equal(assetRelationCode, "23503", "an image must not reference another account's topic");

    await client.query("SAVEPOINT cross_account_blob");
    let blobOwnershipCode: string | undefined;
    try {
      await client.query(
        "INSERT INTO asset_blobs (asset_id,user_id,encrypted_bytes) VALUES ($1,$2,$3)",
        [assetAWithoutBlob, userB, randomBytes(29)],
      );
    } catch (error) {
      blobOwnershipCode = sqlState(error);
      await client.query("ROLLBACK TO SAVEPOINT cross_account_blob");
    }
    assert.ok(blobOwnershipCode === "42501" || blobOwnershipCode === "23503", "an image blob must share its metadata owner's account");

    console.log("Tenant-isolation checks passed: cross-account reads are hidden and cross-account relationships are rejected.");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Tenant-isolation test failed.");
  process.exit(1);
});
