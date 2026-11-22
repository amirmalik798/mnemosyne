import { requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { TopicCard, type TopicItem, EmptyState } from "@/components/archive-ui";

export const dynamic = "force-dynamic";
export default async function TopicsPage() {
  const session = await requireVaultSession();
  const result = await db.query(`SELECT t.*, (SELECT COUNT(*)::int FROM notes n WHERE n.topic_id=t.id AND n.deleted_at IS NULL) AS note_count FROM topics t ORDER BY t.updated_at DESC`);
  const topics: TopicItem[] = result.rows.map((r) => ({ id:r.id,title:decryptText(r.title_enc,session.key),subject:decryptText(r.subject_enc,session.key),description:decryptText(r.description_enc,session.key),category:decryptText(r.category_enc,session.key),coverUrl:r.cover_asset_id?`/api/assets/${r.cover_asset_id}`:null,noteCount:r.note_count,updatedAt:r.updated_at }));
  return <main className="page"><div className="page-heading"><div><div className="eyebrow">The archive</div><h1 className="page-title">Your topics</h1><p className="page-subtitle">Organize your thinking into collections that make sense to you.</p></div><div className="stats"><div className="stat"><strong>{topics.length}</strong><span>Collections</span></div></div></div>
    {topics.length ? <div className="topic-grid">{topics.map((topic) => <TopicCard key={topic.id} topic={topic}/>)}</div> : <EmptyState title="No topics created" copy="Create a collection for a subject, project, book or idea you want to develop." />}
  </main>;
}
