import Link from "next/link";
import { FilePlus } from "lucide-react";
import { requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { EmptyState, NoteRow, type NoteItem } from "@/components/archive-ui";
import { ARCHIVE_PAGE_SIZE, ArchivePagination, parseArchivePage } from "@/components/archive-pagination";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ page?: string | string[] }> };

export default async function NotesPage({ searchParams }: Props) {
  const [{ page: requestedPage }, session] = await Promise.all([
    searchParams,
    requireVaultSession(),
  ]);
  const requestedPageNumber = parseArchivePage(requestedPage);

  const [countResult, pageResult] = await Promise.all([
    db.query("SELECT COUNT(*)::int AS total FROM notes WHERE deleted_at IS NULL"),
    db.query(
      `SELECT n.id, n.topic_id, n.title_enc, n.subject_enc, n.pinned, n.updated_at,
              t.title_enc AS topic_title_enc
       FROM notes n
       JOIN topics t ON t.id = n.topic_id
       WHERE n.deleted_at IS NULL
       ORDER BY n.pinned DESC, n.updated_at DESC, n.id DESC
       LIMIT $1 OFFSET $2`,
      [ARCHIVE_PAGE_SIZE, (requestedPageNumber - 1) * ARCHIVE_PAGE_SIZE],
    ),
  ]);

  const totalNotes = Number(countResult.rows[0]?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalNotes / ARCHIVE_PAGE_SIZE));
  const currentPage = Math.min(requestedPageNumber, totalPages);
  const result = currentPage === requestedPageNumber
    ? pageResult
    : await db.query(
        `SELECT n.id, n.topic_id, n.title_enc, n.subject_enc, n.pinned, n.updated_at,
                t.title_enc AS topic_title_enc
         FROM notes n
         JOIN topics t ON t.id = n.topic_id
         WHERE n.deleted_at IS NULL
         ORDER BY n.pinned DESC, n.updated_at DESC, n.id DESC
         LIMIT $1 OFFSET $2`,
        [ARCHIVE_PAGE_SIZE, (currentPage - 1) * ARCHIVE_PAGE_SIZE],
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
          <div className="eyebrow">Your writing</div>
          <h1 className="page-title">All notes</h1>
          <p className="page-subtitle">Every thought and reference, gathered in one searchable place.</p>
        </div>
        <div className="stats">
          <div className="stat"><strong>{totalNotes}</strong><span>Notes</span></div>
        </div>
      </div>
      <section className="panel">
        <div className="note-list">
          {notes.length ? notes.map((note) => <NoteRow key={note.id} note={note} />) : (
            <EmptyState
              title="No notes yet"
              copy="Start with a short thought or build a longer reflection in the editor."
              action={<Link href="/notes/new" className="primary-btn"><FilePlus size={14} /> Create note</Link>}
            />
          )}
        </div>
      </section>
      <ArchivePagination currentPage={currentPage} totalItems={totalNotes} basePath="/notes" />
    </main>
  );
}
