import { notFound } from "next/navigation";
import { requireVaultSession } from "@/lib/auth";
import { queryAsUser } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { TopicEditForm } from "@/components/topic-edit-form";

export const dynamic = "force-dynamic";

export default async function EditTopicPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session] = await Promise.all([params, requireVaultSession()]);
  const result = await queryAsUser(session.userId, 
    `SELECT t.id, t.title_enc, t.subject_enc, t.description_enc, t.category_enc,
            t.cover_asset_id, (SELECT COUNT(*)::int FROM notes n
            WHERE n.topic_id=t.id) AS note_count
     FROM topics t WHERE t.id=$1`,
    [id],
  );
  if (!result.rows[0]) notFound();
  const row = result.rows[0];
  return <TopicEditForm
    topic={{
      id,
      title: decryptText(row.title_enc, session.key),
      subject: decryptText(row.subject_enc, session.key),
      description: decryptText(row.description_enc, session.key),
      category: decryptText(row.category_enc, session.key),
      coverUrl: row.cover_asset_id ? `/api/assets/${row.cover_asset_id}` : null,
      noteCount: row.note_count,
    }}
  />;
}
