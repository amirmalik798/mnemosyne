import Link from "next/link";
import { Plus, ArrowUpRight, FileText } from "lucide-react";
import { requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { EmptyState, NoteRow, TopicCard, type TopicItem, type NoteItem } from "@/components/archive-ui";

export const dynamic = "force-dynamic";

type LibraryRecordType = "topic" | "note";

type LibraryDecryptionIssue = {
  type: LibraryRecordType;
  id: string;
};

function decryptLibraryField(
  value: unknown,
  key: Buffer,
  context: { type: LibraryRecordType; id: string; field: string },
): string {
  try {
    if (!Buffer.isBuffer(value)) {
      throw new Error("Encrypted database field is not a byte buffer.");
    }
    return decryptText(value, key);
  } catch (error) {
    // Log identifiers and the field name only. Never log ciphertext, plaintext,
    // session keys, or other sensitive vault material.
    console.error("[Mnemosyne] Library encrypted field failed authentication.", {
      recordType: context.type,
      recordId: context.id,
      field: context.field,
      reason: error instanceof Error ? error.message : "Unknown decryption error",
    });
    throw error;
  }
}

export default async function LibraryPage() {
  const session = await requireVaultSession();
  const [topicsResult, notesResult, totalResult] = await Promise.all([
    db.query(`SELECT t.id, t.title_enc, t.subject_enc, t.description_enc, t.category_enc, t.cover_asset_id, t.updated_at, (SELECT COUNT(*)::int FROM notes n WHERE n.topic_id=t.id AND n.deleted_at IS NULL) AS note_count FROM topics t ORDER BY t.updated_at DESC, t.id DESC LIMIT 6`),
    db.query(`SELECT n.id, n.topic_id, n.title_enc, n.subject_enc, n.pinned, n.updated_at, t.title_enc AS topic_title_enc FROM notes n JOIN topics t ON t.id=n.topic_id WHERE n.deleted_at IS NULL ORDER BY n.pinned DESC,n.updated_at DESC,n.id DESC LIMIT 6`),
    db.query(`SELECT (SELECT COUNT(*)::int FROM topics) AS topics, (SELECT COUNT(*)::int FROM notes WHERE deleted_at IS NULL) AS notes, (SELECT COUNT(*)::int FROM assets) AS assets`),
  ]);

  const decryptionIssues: LibraryDecryptionIssue[] = [];
  const topics: TopicItem[] = [];

  for (const row of topicsResult.rows) {
    try {
      const id = String(row.id);
      topics.push({
        id,
        title: decryptLibraryField(row.title_enc, session.key, { type: "topic", id, field: "title_enc" }),
        subject: decryptLibraryField(row.subject_enc, session.key, { type: "topic", id, field: "subject_enc" }),
        description: decryptLibraryField(row.description_enc, session.key, { type: "topic", id, field: "description_enc" }),
        category: decryptLibraryField(row.category_enc, session.key, { type: "topic", id, field: "category_enc" }),
        coverUrl: row.cover_asset_id ? `/api/assets/${row.cover_asset_id}` : null,
        noteCount: row.note_count,
        updatedAt: row.updated_at,
      });
    } catch {
      decryptionIssues.push({ type: "topic", id: String(row.id) });
    }
  }

  const notes: NoteItem[] = [];
  for (const row of notesResult.rows) {
    try {
      const id = String(row.id);
      notes.push({
        id,
        topicId: row.topic_id,
        topicTitle: decryptLibraryField(row.topic_title_enc, session.key, { type: "note", id, field: "topic_title_enc" }),
        title: decryptLibraryField(row.title_enc, session.key, { type: "note", id, field: "title_enc" }),
        subject: decryptLibraryField(row.subject_enc, session.key, { type: "note", id, field: "subject_enc" }),
        pinned: row.pinned,
        updatedAt: row.updated_at,
      });
    } catch {
      decryptionIssues.push({ type: "note", id: String(row.id) });
    }
  }

  const stats = totalResult.rows[0];

  return <main className="page">
    <div className="page-heading"><div><div className="eyebrow">A personal athenaeum</div><h1 className="page-title">Your knowledge, <em>well kept.</em></h1><p className="page-subtitle">A considered space for your research, reflections and the ideas worth returning to.</p></div><div className="stats"><div className="stat"><strong>{stats.topics}</strong><span>Topics</span></div><div className="stat"><strong>{stats.notes}</strong><span>Notes</span></div><div className="stat"><strong>{stats.assets}</strong><span>Images</span></div></div></div>

    {decryptionIssues.length > 0 && (
      <section
        className="panel"
        role="alert"
        aria-live="assertive"
        style={{ marginBottom: 24, borderColor: "rgba(227,143,145,.42)" }}
      >
        <div style={{ color: "var(--red)", fontWeight: 600, marginBottom: 8 }}>
          Some encrypted records could not be authenticated
        </div>
        <p style={{ color: "var(--muted)", fontSize: 11, lineHeight: 1.7, margin: 0 }}>
          {decryptionIssues.length} recent {decryptionIssues.length === 1 ? "record was" : "records were"} skipped because the encrypted data could not be verified. No records were changed or deleted.
          Lock the vault and unlock it once to refresh the active session. If this warning returns, leave the affected data untouched and investigate the record identifiers and field names in the server logs. A known-good backup may be needed if the stored ciphertext is damaged.
        </p>
      </section>
    )}

    <div className="toolbar"><div className="eyebrow">Your collections</div><Link className="secondary-btn" href="/topics">View all topics <ArrowUpRight size={14} /></Link></div>
    {topics.length ? <div className="topic-grid">{topics.map((topic) => <TopicCard key={topic.id} topic={topic} />)}<Link href="/topics" className="create-card"><span className="plus"><Plus /></span><strong>Explore your topics</strong><p>Open the full archive or create a new collection from the top bar.</p></Link></div> : <EmptyState title="Your archive begins here" copy="Create a topic for a subject you want to explore. Add notes, references and images as your thinking develops." action={<Link href="/topics" className="primary-btn"><Plus size={15}/> Create your first topic</Link>} />}
    <div className="toolbar" style={{ marginTop: 43 }}><div><div className="eyebrow">Recently touched</div><h2 className="panel-title" style={{ margin: "7px 0 0" }}>Continue thinking</h2></div><Link className="secondary-btn" href="/notes">All notes <ArrowUpRight size={14}/></Link></div>
    <section className="panel"><div className="note-list">{notes.length ? notes.map((note) => <NoteRow key={note.id} note={note}/>) : <EmptyState title="No notes yet" copy="Your notes will appear here as soon as you create the first one." action={<Link href="/notes/new" className="secondary-btn"><FileText size={14}/> Write a note</Link>} />}</div></section>
  </main>;
}
