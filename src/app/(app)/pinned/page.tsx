import Link from "next/link";
import { ArrowUpRight, FileText, Pin } from "lucide-react";
import { requireVaultSession } from "@/lib/auth";
import { queryAsUser } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { EmptyState, NoteRow, type NoteItem } from "@/components/archive-ui";
import { ARCHIVE_PAGE_SIZE, ArchivePagination, parseArchivePage } from "@/components/archive-pagination";
import { ArchiveSortControl } from "@/components/archive-sort-control";
import { compareArchiveTitles, isAlphabeticalArchiveSort, parseArchiveSort } from "@/lib/archive-sort";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ page?: string | string[]; sort?: string | string[] }> };

export default async function PinnedNotesPage({ searchParams }: Props) {
  const [{ page: requestedPage, sort: requestedSort }, session] = await Promise.all([
    searchParams,
    requireVaultSession(),
  ]);
  const requestedPageNumber = parseArchivePage(requestedPage);
  const sort = parseArchiveSort(requestedSort);
  const alphabetical = isAlphabeticalArchiveSort(sort);

  const countResult = await queryAsUser(session.userId, 
    "SELECT COUNT(*)::int AS total FROM notes WHERE deleted_at IS NULL AND pinned = TRUE",
  );
  const totalNotes = Number(countResult.rows[0]?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalNotes / ARCHIVE_PAGE_SIZE));
  const currentPage = Math.min(requestedPageNumber, totalPages);
  const orderColumn = sort === "modified-desc" ? "n.updated_at" : "n.created_at";
  const result = alphabetical
    ? await queryAsUser(session.userId,
        `SELECT n.id, n.topic_id, n.title_enc, n.subject_enc, n.pinned, n.created_at, n.updated_at,
                t.title_enc AS topic_title_enc
         FROM notes n
         JOIN topics t ON t.id = n.topic_id
         WHERE n.deleted_at IS NULL AND n.pinned = TRUE
         ORDER BY n.created_at DESC, n.id DESC`,
      )
    : await queryAsUser(session.userId,
        `SELECT n.id, n.topic_id, n.title_enc, n.subject_enc, n.pinned, n.created_at, n.updated_at,
                t.title_enc AS topic_title_enc
         FROM notes n
         JOIN topics t ON t.id = n.topic_id
         WHERE n.deleted_at IS NULL AND n.pinned = TRUE
         ORDER BY ${orderColumn} DESC, n.id DESC
         LIMIT $1 OFFSET $2`,
        [ARCHIVE_PAGE_SIZE, (currentPage - 1) * ARCHIVE_PAGE_SIZE],
      );

  const decryptedNotes: NoteItem[] = result.rows.map((row) => ({
    id: row.id,
    topicId: row.topic_id,
    topicTitle: decryptText(row.topic_title_enc, session.key),
    title: decryptText(row.title_enc, session.key),
    subject: decryptText(row.subject_enc, session.key),
    pinned: row.pinned,
    updatedAt: row.updated_at,
  }));

  if (alphabetical) decryptedNotes.sort((a, b) => compareArchiveTitles(a, b, sort));
  const notes = alphabetical
    ? decryptedNotes.slice((currentPage - 1) * ARCHIVE_PAGE_SIZE, currentPage * ARCHIVE_PAGE_SIZE)
    : decryptedNotes;

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
          <div className="stat"><strong>{totalNotes}</strong><span>Pinned {totalNotes === 1 ? "note" : "notes"}</span></div>
        </div>
      </div>

      <div className="toolbar">
        <div className="eyebrow">Saved for later</div>
        <ArchiveSortControl basePath="/pinned" currentSort={sort} />
        <Link href="/notes" className="secondary-btn icon-only-btn" aria-label="Browse all notes" title="Browse all notes"><ArrowUpRight size={17} /></Link>
      </div>

      <section className="panel">
        <div className="note-list">
          {notes.length ? notes.map((note) => <NoteRow key={note.id} note={note} />) : (
            <EmptyState
              title="Nothing pinned yet"
              copy="Pin an important note from its editor. It will appear here so you can return to it without searching your entire archive."
              action={<Link href="/notes" className="secondary-btn icon-only-btn" aria-label="Explore all notes" title="Explore all notes"><FileText size={17} /></Link>}
            />
          )}
        </div>
      </section>
      <ArchivePagination currentPage={currentPage} totalItems={totalNotes} basePath="/pinned" query={sort === "created-desc" ? undefined : `sort=${sort}`} />
    </main>
  );
}
