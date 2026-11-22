import Link from "next/link";
import { FilePlus } from "lucide-react";
import { requireVaultSession } from "@/lib/auth";
import { queryAsUser } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { ArchiveIntegrityNotice, EmptyState, NoteRow, type NoteItem } from "@/components/archive-ui";
import { ARCHIVE_PAGE_SIZE, ArchivePagination, parseArchivePage } from "@/components/archive-pagination";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ page?: string | string[] }> };

function decryptNoteValue(value: unknown, key: Buffer, id: string, field: string): string | null {
  try {
    if (!Buffer.isBuffer(value)) throw new Error("Encrypted field is not a byte buffer.");
    return decryptText(value, key);
  } catch (error) {
    console.error("[Mnemosyne] Note archive encrypted field failed authentication.", {
      recordType: "note",
      recordId: id,
      field,
      reason: error instanceof Error ? error.message : "Unknown decryption error",
    });
    return null;
  }
}

export default async function NotesPage({ searchParams }: Props) {
  const [{ page: requestedPage }, session] = await Promise.all([
    searchParams,
    requireVaultSession(),
  ]);
  const requestedPageNumber = parseArchivePage(requestedPage);

  const countResult = await queryAsUser(session.userId, "SELECT COUNT(*)::int AS total FROM notes WHERE deleted_at IS NULL");
  const totalNotes = Number(countResult.rows[0]?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalNotes / ARCHIVE_PAGE_SIZE));
  const currentPage = Math.min(requestedPageNumber, totalPages);
  const result = await queryAsUser(session.userId, 
    `SELECT n.id, n.topic_id, n.title_enc, n.subject_enc, n.pinned, n.updated_at,
              t.title_enc AS topic_title_enc
       FROM notes n
       JOIN topics t ON t.id = n.topic_id
       WHERE n.deleted_at IS NULL
       ORDER BY n.pinned DESC, n.updated_at DESC, n.id DESC
       LIMIT $1 OFFSET $2`,
    [ARCHIVE_PAGE_SIZE, (currentPage - 1) * ARCHIVE_PAGE_SIZE],
  );

  const notes: NoteItem[] = [];
  const unavailableNoteIds = new Set<string>();
  for (const row of result.rows) {
    const id = String(row.id);
    const topicTitle = decryptNoteValue(row.topic_title_enc, session.key, id, "topic_title_enc");
    const title = decryptNoteValue(row.title_enc, session.key, id, "title_enc");
    const subject = decryptNoteValue(row.subject_enc, session.key, id, "subject_enc");
    if (topicTitle === null || title === null || subject === null) {
      unavailableNoteIds.add(id);
      continue;
    }
    notes.push({
      id,
      topicId: row.topic_id,
      topicTitle,
      title,
      subject,
      pinned: row.pinned,
      updatedAt: row.updated_at,
    });
  }

  return (
    <main className="page">
      <ArchiveIntegrityNotice count={unavailableNoteIds.size} itemLabel="note" />
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
              title={unavailableNoteIds.size ? "Some notes are unavailable" : "No notes yet"}
              copy={unavailableNoteIds.size
                ? "Their encrypted fields could not be authenticated. The original records remain unchanged; investigate the vault key and backup before making further changes."
                : "Start with a short thought or build a longer reflection in the editor."}
              action={unavailableNoteIds.size ? undefined : <Link href="/notes/new" className="primary-btn"><FilePlus size={14} /> Create note</Link>}
            />
          )}
        </div>
      </section>
      <ArchivePagination currentPage={currentPage} totalItems={totalNotes} basePath="/notes" />
    </main>
  );
}
