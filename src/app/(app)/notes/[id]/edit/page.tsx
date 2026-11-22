import { notFound } from "next/navigation";
import { requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { NoteEditor } from "@/components/note-editor";

export const dynamic = "force-dynamic";

export default async function EditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session] = await Promise.all([params, requireVaultSession()]);
  const noteResult = await db.query(
    "SELECT * FROM notes WHERE id=$1 AND deleted_at IS NULL",
    [id],
  );
  if (!noteResult.rows[0]) notFound();
  const note = noteResult.rows[0];

  const topic = await db.query(
    "SELECT id FROM topics WHERE id=$1",
    [note.topic_id],
  );
  if (!topic.rows[0]) notFound();

  return (
    <NoteEditor
      topics={[]}
      initialNote={{
        id: note.id,
        topicId: note.topic_id,
        title: decryptText(note.title_enc, session.key),
        subject: decryptText(note.subject_enc, session.key),
        content: JSON.parse(decryptText(note.content_enc, session.key)),
        tags: JSON.parse(decryptText(note.tags_enc, session.key)),
        pinned: note.pinned,
        updatedAt: note.updated_at,
      }}
    />
  );
}
