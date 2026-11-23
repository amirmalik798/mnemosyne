import Link from "next/link";
import { ArrowRight, ArrowUpRight, BookOpen, FilePlus, FileText, Search, Sparkles } from "lucide-react";
import { requireVaultSession } from "@/lib/auth";
import { queryAsUser } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { ArchiveIntegrityNotice, EmptyState, NoteRow, type NoteItem } from "@/components/archive-ui";
import { ARCHIVE_PAGE_SIZE, ArchivePagination, parseArchivePage } from "@/components/archive-pagination";
import { ArchiveSortControl } from "@/components/archive-sort-control";
import { compareArchiveTitles, isAlphabeticalArchiveSort, parseArchiveSort } from "@/lib/archive-sort";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ page?: string | string[]; sort?: string | string[] }> };

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
  const [{ page: requestedPage, sort: requestedSort }, session] = await Promise.all([
    searchParams,
    requireVaultSession(),
  ]);
  const requestedPageNumber = parseArchivePage(requestedPage);
  const sort = parseArchiveSort(requestedSort);
  const alphabetical = isAlphabeticalArchiveSort(sort);

  const countResult = await queryAsUser(session.userId, "SELECT COUNT(*)::int AS total FROM notes WHERE deleted_at IS NULL");
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
         WHERE n.deleted_at IS NULL
         ORDER BY n.created_at DESC, n.id DESC`,
      )
    : await queryAsUser(session.userId,
        `SELECT n.id, n.topic_id, n.title_enc, n.subject_enc, n.pinned, n.created_at, n.updated_at,
                t.title_enc AS topic_title_enc
         FROM notes n
         JOIN topics t ON t.id = n.topic_id
         WHERE n.deleted_at IS NULL
         ORDER BY ${orderColumn} DESC, n.id DESC
         LIMIT $1 OFFSET $2`,
        [ARCHIVE_PAGE_SIZE, (currentPage - 1) * ARCHIVE_PAGE_SIZE],
      );

  const decryptedNotes: NoteItem[] = [];
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
    decryptedNotes.push({
      id,
      topicId: row.topic_id,
      topicTitle,
      title,
      subject,
      pinned: row.pinned,
      updatedAt: row.updated_at,
      dateAt: sort === "created-desc" ? row.created_at : row.updated_at,
      dateLabel: sort === "created-desc" ? "Created" : "Modified",
    });
  }

  if (alphabetical) decryptedNotes.sort((a, b) => compareArchiveTitles(a, b, sort));
  const notes = alphabetical
    ? decryptedNotes.slice((currentPage - 1) * ARCHIVE_PAGE_SIZE, currentPage * ARCHIVE_PAGE_SIZE)
    : decryptedNotes;

  return (
    <main className="page all-notes-page">
      <ArchiveIntegrityNotice count={unavailableNoteIds.size} itemLabel="note" />
      <header className="all-notes-hero">
        <div className="all-notes-hero-copy">
          <div className="eyebrow">Your writing · The complete archive</div>
          <h1 className="page-title">All <em>notes.</em></h1>
          <p className="page-subtitle">Every thought, reference and passing idea, gathered in one considered place.</p>
          <div className="all-notes-promise">
            <span className="all-notes-promise-icon"><BookOpen size={16} aria-hidden="true" /></span>
            <span>
              <strong>Your work, in one place.</strong>
              <small>Browse, revisit and continue developing every note in your archive.</small>
            </span>
          </div>
        </div>

        <aside className="all-notes-count-card" aria-label={`${totalNotes} total ${totalNotes === 1 ? "note" : "notes"}`}>
          <div className="all-notes-count-top">
            <span className="all-notes-count-icon"><FileText size={18} aria-hidden="true" /></span>
            <span className="all-notes-count-label">Your archive</span>
          </div>
          <div className="all-notes-count-value">
            <strong>{totalNotes}</strong>
            <span>{totalNotes === 1 ? "note" : "notes"} in your library</span>
          </div>
          <div className="all-notes-count-foot">
            <span className="all-notes-count-dot" />
            {unavailableNoteIds.size > 0
              ? `${unavailableNoteIds.size} ${unavailableNoteIds.size === 1 ? "note needs" : "notes need"} attention`
              : "Private and encrypted"}
          </div>
        </aside>
      </header>

      <section className="all-notes-workspace" aria-labelledby="all-notes-workspace-title">
        <div className="all-notes-workspace-header">
          <div className="all-notes-workspace-copy">
            <span className="eyebrow">The collection</span>
            <h2 id="all-notes-workspace-title">Your notes</h2>
            <p>
              {notes.length > 0
                ? `Showing ${notes.length} ${notes.length === 1 ? "note" : "notes"} from your archive.`
                : totalNotes > 0
                  ? "Some records need attention before they can be displayed."
                  : "A quiet space, ready for your next thought."}
            </p>
          </div>
          <div className="all-notes-workspace-actions">
            <ArchiveSortControl basePath="/notes" currentSort={sort} />
            <Link href="/search" className="secondary-btn all-notes-search-button">
              <Search size={15} aria-hidden="true" />
              <span>Search archive</span>
            </Link>
            <Link href="/notes/new" className="primary-btn all-notes-create-button">
              <FilePlus size={15} aria-hidden="true" />
              <span>New note</span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </div>

        <div className={`all-notes-surface ${notes.length === 0 ? "is-empty" : "has-notes"}`}>
          {notes.length > 0 ? (
            <div className="note-list" aria-label="All notes">
              {notes.map((note) => <NoteRow key={note.id} note={note} showOpenCue />)}
            </div>
          ) : unavailableNoteIds.size > 0 ? (
            <EmptyState
              title="Your notes need attention"
              copy="Some encrypted records could not be authenticated. The original notes remain unchanged. Review the integrity notice above and check the original vault key and a trusted backup before making further changes."
            />
          ) : (
            <div className="all-notes-empty" role="region" aria-labelledby="all-notes-empty-title" aria-describedby="all-notes-empty-description">
              <div className="all-notes-empty-art" aria-hidden="true">
                <span className="all-notes-empty-orbit all-notes-empty-orbit-one" />
                <span className="all-notes-empty-orbit all-notes-empty-orbit-two" />
                <span className="all-notes-empty-paper all-notes-empty-paper-back" />
                <span className="all-notes-empty-paper all-notes-empty-paper-front">
                  <span />
                  <span />
                  <span />
                </span>
                <span className="all-notes-empty-book"><BookOpen size={32} strokeWidth={1.35} /></span>
                <span className="all-notes-empty-spark all-notes-empty-spark-one">✦</span>
                <span className="all-notes-empty-spark all-notes-empty-spark-two">✧</span>
              </div>

              <div className="all-notes-empty-copy">
                <span className="eyebrow">A new chapter begins</span>
                <h3 id="all-notes-empty-title">Give your first idea a place.</h3>
                <p id="all-notes-empty-description">
                  Start with a sentence, a passing thought or a longer reflection.
                  Your notes stay private in your encrypted archive, ready to grow with you.
                </p>
                <div className="all-notes-empty-actions">
                  <Link href="/notes/new" className="primary-btn all-notes-first-note">
                    <FilePlus size={16} aria-hidden="true" />
                    <span>Create your first note</span>
                    <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                  <Link href="/topics" className="all-notes-explore-topics">
                    Explore your topics <ArrowUpRight size={14} aria-hidden="true" />
                  </Link>
                </div>
              </div>

              <aside className="all-notes-empty-guide" aria-label="A simple way to begin">
                <div className="all-notes-guide-heading">
                  <Sparkles size={15} aria-hidden="true" />
                  <span>A simple way to begin</span>
                </div>
                <div className="all-notes-guide-step">
                  <span className="all-notes-guide-number">01</span>
                  <span><strong>Capture an idea</strong><small>Write a thought before it slips away.</small></span>
                </div>
                <span className="all-notes-guide-line" aria-hidden="true" />
                <div className="all-notes-guide-step">
                  <span className="all-notes-guide-number">02</span>
                  <span><strong>Give it context</strong><small>Add a subject or place it in a topic.</small></span>
                </div>
                <span className="all-notes-guide-line" aria-hidden="true" />
                <div className="all-notes-guide-step">
                  <span className="all-notes-guide-number">03</span>
                  <span><strong>Return and develop</strong><small>Your archive keeps each note close.</small></span>
                </div>
              </aside>
            </div>
          )}
        </div>
      </section>
      <ArchivePagination currentPage={currentPage} totalItems={totalNotes} basePath="/notes" query={sort === "created-desc" ? undefined : `sort=${sort}`} />
    </main>
  );
}
