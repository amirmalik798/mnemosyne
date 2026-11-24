import Link from "next/link";
import { ArrowRight, ArrowUpRight, BookOpen, FileText, Pin, Sparkles } from "lucide-react";
import { requireVaultSession } from "@/lib/auth";
import { queryAsUser } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { NoteRow, type NoteItem } from "@/components/archive-ui";
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
    dateAt: sort === "created-desc" ? row.created_at : row.updated_at,
    dateLabel: sort === "created-desc" ? "Created" : "Modified",
  }));

  if (alphabetical) decryptedNotes.sort((a, b) => compareArchiveTitles(a, b, sort));
  const notes = alphabetical
    ? decryptedNotes.slice((currentPage - 1) * ARCHIVE_PAGE_SIZE, currentPage * ARCHIVE_PAGE_SIZE)
    : decryptedNotes;

  return (
    <main className="page pinned-page">
      <header className="pinned-page-hero">
        <div className="pinned-page-heading">
          <div className="eyebrow">Your reading list · Curated by you</div>
          <h1 className="page-title">Pinned <em>notes.</em></h1>
          <p className="page-subtitle">The ideas, references and passages worth keeping within easy reach.</p>
          <div className="pinned-page-promise">
            <span className="pinned-page-promise-icon"><Pin size={16} aria-hidden="true" /></span>
            <span>
              <strong>A considered collection.</strong>
              <small>Pin a note once. Find it here whenever you need it.</small>
            </span>
          </div>
        </div>

        <aside className="pinned-collection-card" aria-label={`${totalNotes} pinned ${totalNotes === 1 ? "note" : "notes"}`}>
          <div className="pinned-collection-card-top">
            <span className="pinned-collection-icon"><BookOpen size={19} aria-hidden="true" /></span>
            <span className="pinned-collection-label">Your collection</span>
          </div>
          <div className="pinned-collection-count-row">
            <strong>{totalNotes}</strong>
            <span>{totalNotes === 1 ? "pinned note" : "pinned notes"}</span>
          </div>
          <div className="pinned-collection-foot">
            <span className="pinned-collection-dot" />
            {totalNotes === 0 ? "Ready for your first note" : "Saved for whenever you return"}
          </div>
        </aside>
      </header>

      <section className="pinned-workspace" aria-labelledby="pinned-workspace-title">
        <div className="pinned-workspace-header">
          <div className="pinned-workspace-title-group">
            <span className="eyebrow">Saved for later</span>
            <h2 id="pinned-workspace-title">Your pinned collection</h2>
            <p>
              {totalNotes === 0
                ? "A quiet place for the notes you want to revisit."
                : `${totalNotes} ${totalNotes === 1 ? "note is" : "notes are"} gathered here for quick access.`}
            </p>
          </div>
          <div className="pinned-workspace-actions">
            <ArchiveSortControl basePath="/pinned" currentSort={sort} />
            <Link href="/notes" className="secondary-btn pinned-browse-button">
              <FileText size={16} aria-hidden="true" />
              <span>Browse all notes</span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </div>

        <div className={`pinned-collection-surface ${notes.length === 0 ? "is-empty" : "has-notes"}`}>
          {notes.length > 0 ? (
            <div className="note-list" aria-label="Pinned notes">
              {notes.map((note) => <NoteRow key={note.id} note={note} />)}
            </div>
          ) : (
            <div className="pinned-empty-state" role="region" aria-labelledby="pinned-empty-title" aria-describedby="pinned-empty-description">
              <div className="pinned-empty-illustration" aria-hidden="true">
                <div className="pinned-empty-orbit pinned-empty-orbit-one" />
                <div className="pinned-empty-orbit pinned-empty-orbit-two" />
                <span className="pinned-empty-book"><BookOpen size={34} strokeWidth={1.35} /></span>
                <span className="pinned-empty-pin"><Pin size={18} strokeWidth={1.6} /></span>
                <span className="pinned-empty-spark pinned-empty-spark-one">✦</span>
                <span className="pinned-empty-spark pinned-empty-spark-two">✧</span>
              </div>

              <div className="pinned-empty-copy">
                <span className="eyebrow">A place for what matters</span>
                <h3 id="pinned-empty-title">Your reading list starts here.</h3>
                <p id="pinned-empty-description">Keep important ideas close. Pin a note and it will be gathered here, ready to revisit without searching your entire archive.</p>
                <Link href="/notes" className="primary-btn pinned-empty-primary">
                  <FileText size={16} aria-hidden="true" />
                  <span>Browse your notes</span>
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </div>

              <div className="pinned-how-to">
                <div className="pinned-how-to-heading">
                  <Sparkles size={15} aria-hidden="true" />
                  <span>Make a note easy to find</span>
                </div>
                <div className="pinned-how-to-steps">
                  <div className="pinned-how-to-step">
                    <span className="pinned-how-to-number">01</span>
                    <span className="pinned-how-to-step-copy">
                      <strong>Open a note</strong>
                      <small>Choose an idea you want to keep close.</small>
                    </span>
                  </div>
                  <span className="pinned-how-to-connector" aria-hidden="true" />
                  <div className="pinned-how-to-step">
                    <span className="pinned-how-to-number">02</span>
                    <span className="pinned-how-to-step-copy">
                      <strong>Select Pin</strong>
                      <small>Use the pin action in the note or its editor.</small>
                    </span>
                  </div>
                  <span className="pinned-how-to-connector" aria-hidden="true" />
                  <div className="pinned-how-to-step">
                    <span className="pinned-how-to-number">03</span>
                    <span className="pinned-how-to-step-copy">
                      <strong>Return anytime</strong>
                      <small>Your note will appear in this collection.</small>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <ArchivePagination currentPage={currentPage} totalItems={totalNotes} basePath="/pinned" query={sort === "created-desc" ? undefined : `sort=${sort}`} />
    </main>
  );
}
