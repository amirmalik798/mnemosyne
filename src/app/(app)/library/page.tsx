import Link from "next/link";
import { Plus, ArrowUpRight, FileText } from "lucide-react";
import { requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { EmptyState, NoteRow, TopicCard, type TopicItem, type NoteItem } from "@/components/archive-ui";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const session = await requireVaultSession();
  const [topicsResult, notesResult, totalResult] = await Promise.all([
    db.query(`SELECT t.*, (SELECT COUNT(*)::int FROM notes n WHERE n.topic_id=t.id AND n.deleted_at IS NULL) AS note_count FROM topics t ORDER BY t.updated_at DESC LIMIT 6`),
    db.query(`SELECT n.*, t.title_enc AS topic_title_enc FROM notes n JOIN topics t ON t.id=n.topic_id WHERE n.deleted_at IS NULL ORDER BY n.pinned DESC,n.updated_at DESC LIMIT 6`),
    db.query(`SELECT (SELECT COUNT(*)::int FROM topics) AS topics, (SELECT COUNT(*)::int FROM notes WHERE deleted_at IS NULL) AS notes, (SELECT COUNT(*)::int FROM assets) AS assets`),
  ]);
  const topics: TopicItem[] = topicsResult.rows.map((r) => ({ id:r.id,title:decryptText(r.title_enc,session.key),subject:decryptText(r.subject_enc,session.key),description:decryptText(r.description_enc,session.key),category:decryptText(r.category_enc,session.key),coverUrl:r.cover_asset_id?`/api/assets/${r.cover_asset_id}`:null,noteCount:r.note_count,updatedAt:r.updated_at }));
  const notes: NoteItem[] = notesResult.rows.map((r) => ({ id:r.id,topicId:r.topic_id,topicTitle:decryptText(r.topic_title_enc,session.key),title:decryptText(r.title_enc,session.key),subject:decryptText(r.subject_enc,session.key),pinned:r.pinned,updatedAt:r.updated_at }));
  const stats = totalResult.rows[0];
  return <main className="page">
    <div className="page-heading"><div><div className="eyebrow">A personal athenaeum</div><h1 className="page-title">Your knowledge, <em>well kept.</em></h1><p className="page-subtitle">A considered space for your research, reflections and the ideas worth returning to.</p></div><div className="stats"><div className="stat"><strong>{stats.topics}</strong><span>Topics</span></div><div className="stat"><strong>{stats.notes}</strong><span>Notes</span></div><div className="stat"><strong>{stats.assets}</strong><span>Images</span></div></div></div>
    <div className="toolbar"><div className="eyebrow">Your collections</div><Link className="secondary-btn" href="/topics">View all topics <ArrowUpRight size={14} /></Link></div>
    {topics.length ? <div className="topic-grid">{topics.map((topic) => <TopicCard key={topic.id} topic={topic} />)}<Link href="/topics" className="create-card"><span className="plus"><Plus /></span><strong>Explore your topics</strong><p>Open the full archive or create a new collection from the top bar.</p></Link></div> : <EmptyState title="Your archive begins here" copy="Create a topic for a subject you want to explore. Add notes, references and images as your thinking develops." action={<Link href="/topics" className="primary-btn"><Plus size={15}/> Create your first topic</Link>} />}
    <div className="toolbar" style={{ marginTop: 43 }}><div><div className="eyebrow">Recently touched</div><h2 className="panel-title" style={{ margin: "7px 0 0" }}>Continue thinking</h2></div><Link className="secondary-btn" href="/notes">All notes <ArrowUpRight size={14}/></Link></div>
    <section className="panel"><div className="note-list">{notes.length ? notes.map((note) => <NoteRow key={note.id} note={note}/>) : <EmptyState title="No notes yet" copy="Your notes will appear here as soon as you create the first one." action={<Link href="/notes/new" className="secondary-btn"><FileText size={14}/> Write a note</Link>} />}</div></section>
  </main>;
}
