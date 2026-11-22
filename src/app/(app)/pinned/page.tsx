import Link from "next/link";
import { ArrowUpRight, FileText, Pin } from "lucide-react";
import { requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { EmptyState, NoteRow, type NoteItem } from "@/components/archive-ui";

export const dynamic = "force-dynamic";

export default async function PinnedNotesPage() {
  const session = await requireVaultSession();
  const result = await db.query(
    `SELECT n.*, t.title_enc AS topic_title_enc
     FROM notes n
     JOIN topics t ON t.id = n.topic_id
     WHERE n.deleted_at IS NULL AND n.pinned = TRUE
     ORDER BY n.updated_at DESC`,
  );

  const notes: NoteItem[] = result.rows.map((row) => ({
    id: row.id,
    topicId: row.topic_id,
    topicTitle: decryptText(row.topic_title_enc, session.key),
    title: decryptText(row.title_enc, session.key),
    subject: decryptText(row.subject_enc, session.key),
    pinned: row.pinned,
    updatedAt: row.updated_at,
  }));

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Your reading list</div>
          <h1 className="page-title">Pinned <em>notes.</em></h1>
          <p className="page-subtitle">The ideas, references and passages you have marked to find again quickly.</p>
          <div className="pinned-page-intro"><Pin /> A focused collection of your most important notes.</div>
        </div>
        <div className="stats">
          <div className="stat"><strong>{notes.length}</strong><span>Pinned {notes.length === 1 ? "note" : "notes"}</span></div>
        </div>
      </div>

      <div className="toolbar">
        <div className="eyebrow">Saved for later</div>
        <Link href="/notes" className="secondary-btn">Browse all notes <ArrowUpRight size={14} /></Link>
      </div>

      <section className="panel">
        <div className="note-list">
          {notes.length ? notes.map((note) => <NoteRow key={note.id} note={note} />) : (
            <EmptyState
              title="Nothing pinned yet"
              copy="Pin an important note from its editor. It will appear here so you can return to it without searching your entire archive."
              action={<Link href="/notes" className="secondary-btn"><FileText size={14} /> Explore all notes</Link>}
            />
          )}
        </div>
      </section>
    </main>
  );
}
