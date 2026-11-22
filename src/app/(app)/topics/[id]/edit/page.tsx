import { notFound } from "next/navigation";
import { requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { TopicEditForm } from "@/components/topic-edit-form";
export const dynamic = "force-dynamic";

export default async function EditTopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireVaultSession();
  const [topicResult, categoryResult] = await Promise.all([
    db.query(`SELECT t.*, (SELECT COUNT(*)::int FROM notes n WHERE n.topic_id=t.id) AS note_count FROM topics t WHERE t.id=$1`, [id]),
    db.query("SELECT category_enc FROM topics WHERE id <> $1", [id]),
  ]);
  if (!topicResult.rows[0]) notFound();
  const row = topicResult.rows[0];
  const categories = Array.from(new Map(
    categoryResult.rows
      .map((item) => decryptText(item.category_enc, session.key).trim())
      .filter(Boolean)
      .map((category) => [category.toLocaleLowerCase(), category] as const),
  ).values()).sort((a, b) => a.localeCompare(b));
  return <TopicEditForm
    topic={{
      id,
      title: decryptText(row.title_enc, session.key),
      subject: decryptText(row.subject_enc, session.key),
      description: decryptText(row.description_enc, session.key),
      category: decryptText(row.category_enc, session.key),
      coverUrl: row.cover_asset_id ? "/api/assets/" + row.cover_asset_id : null,
      noteCount: row.note_count,
    }}
    categories={categories}
  />;
}