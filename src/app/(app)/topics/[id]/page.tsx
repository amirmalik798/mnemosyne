import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, FilePlus, FileText } from "lucide-react";
import { requireVaultSession } from "@/lib/auth";
import { queryAsUser } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { NoteRow, EmptyState, type NoteItem } from "@/components/archive-ui";
import { detectTextLanguage } from "@/lib/bidi";
import { TopicImageDownload } from "@/components/topic-image-download";
import { TopicEditDialog } from "@/components/topic-edit-dialog";
import { ARCHIVE_PAGE_SIZE, ArchivePagination, parseArchivePage } from "@/components/archive-pagination";
import { ArchiveSortControl } from "@/components/archive-sort-control";
import { ArchivePinFilter, type ArchivePinFilterValue } from "@/components/archive-pin-filter";
import { compareArchiveTitles, isAlphabeticalArchiveSort, parseArchiveSort } from "@/lib/archive-sort";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string | string[]; sort?: string | string[]; pin?: string | string[] }>;
};
export const dynamic = "force-dynamic";

function parseTopicPinFilter(value: string | string[] | undefined): ArchivePinFilterValue {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "pinned" || candidate === "unpinned" ? candidate : "all";
}

export default async function TopicPage({ params, searchParams }: Props) {
  const [{ id }, { page: requestedPage, sort: requestedSort, pin: requestedPinFilter }, session] = await Promise.all([
    params,
    searchParams,
    requireVaultSession(),
  ]);
  const requestedPageNumber = parseArchivePage(requestedPage);
  const sort = parseArchiveSort(requestedSort);
  const pinFilter = parseTopicPinFilter(requestedPinFilter);
  const pinCondition = pinFilter === "pinned" ? " AND pinned=true" : pinFilter === "unpinned" ? " AND pinned=false" : "";
  const alphabetical = isAlphabeticalArchiveSort(sort);
  const result = await queryAsUser(session.userId, 
    "SELECT id,title_enc,subject_enc,description_enc,category_enc,cover_asset_id,created_at,updated_at FROM topics WHERE id=$1",
    [id],
  );
  if (!result.rows[0]) notFound();
  const row = result.rows[0];

  const [countResult, activeNotesCountResult, coverAssetResult, allNotesCountResult] = await Promise.all([
    queryAsUser(session.userId, `SELECT COUNT(*)::int AS total FROM notes WHERE topic_id=$1 AND deleted_at IS NULL${pinCondition}`, [id]),
    queryAsUser(session.userId, "SELECT COUNT(*)::int AS total FROM notes WHERE topic_id=$1 AND deleted_at IS NULL", [id]),
    row.cover_asset_id
      ? queryAsUser(session.userId, "SELECT id FROM assets WHERE id=$1 AND owner_type='topic' AND owner_id=$2", [row.cover_asset_id, id])
      : Promise.resolve({ rows: [] }),
    queryAsUser(session.userId, "SELECT COUNT(*)::int AS total FROM notes WHERE topic_id=$1", [id]),
  ]);
  const totalNotes = Number(countResult.rows[0]?.total ?? 0);
  const totalActiveNotes = Number(activeNotesCountResult.rows[0]?.total ?? 0);
  const totalNotesIncludingTrash = Number(allNotesCountResult.rows[0]?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalNotes / ARCHIVE_PAGE_SIZE));
  const currentPage = Math.min(requestedPageNumber, totalPages);
  const orderColumn = sort === "modified-desc" ? "updated_at" : "created_at";
  const notesResult = alphabetical
    ? await queryAsUser(session.userId,
        `SELECT id,title_enc,subject_enc,pinned,created_at,updated_at
         FROM notes
         WHERE topic_id=$1 AND deleted_at IS NULL${pinCondition}
         ORDER BY created_at DESC,id DESC`,
        [id],
      )
    : await queryAsUser(session.userId,
        `SELECT id,title_enc,subject_enc,pinned,created_at,updated_at
         FROM notes
         WHERE topic_id=$1 AND deleted_at IS NULL${pinCondition}
         ORDER BY ${orderColumn} DESC,id DESC
         LIMIT $2 OFFSET $3`,
        [id, ARCHIVE_PAGE_SIZE, (currentPage - 1) * ARCHIVE_PAGE_SIZE],
      );
  const topicTitle = decryptText(row.title_enc, session.key);
  const decryptedNotes: NoteItem[] = notesResult.rows.map((note) => ({
    id: note.id,
    topicId: id,
    topicTitle,
    title: decryptText(note.title_enc, session.key),
    subject: decryptText(note.subject_enc, session.key),
    pinned: note.pinned,
    updatedAt: note.updated_at,
    dateAt: sort === "created-desc" ? note.created_at : note.updated_at,
    dateLabel: sort === "created-desc" ? "Created" : "Modified",
  }));
  if (alphabetical) decryptedNotes.sort((a, b) => compareArchiveTitles(a, b, sort));
  const notes = alphabetical
    ? decryptedNotes.slice((currentPage - 1) * ARCHIVE_PAGE_SIZE, currentPage * ARCHIVE_PAGE_SIZE)
    : decryptedNotes;

  const imageAssetsResult = await queryAsUser(session.userId, 
    `SELECT COUNT(*)::int AS total
     FROM assets a
     JOIN notes n ON n.id = a.owner_id
     WHERE a.owner_type = 'note'
       AND n.topic_id = $1
       AND n.deleted_at IS NULL`,
    [id],
  );
  const validNoteImageCount = Number(imageAssetsResult.rows[0]?.total ?? 0);
  const imageCount = validNoteImageCount + (coverAssetResult.rows.length ? 1 : 0);
  const title = topicTitle;
  const subject = decryptText(row.subject_enc, session.key);
  const description = decryptText(row.description_enc, session.key);
  const category = decryptText(row.category_enc, session.key);
  const cover = row.cover_asset_id && coverAssetResult.rows.length
    ? `/api/assets/${row.cover_asset_id}`
    : null;

  return (
    <main className="page topic-detail-page">
      <div className="topic-detail-back">
        <Link href="/topics" className="breadcrumb topic-detail-back-link"><ArrowLeft size={14}/> All topics</Link>
      </div>
      <section className="panel topic-detail-hero" aria-labelledby="topic-detail-title">
        <div className="topic-detail-cover">
          {cover ? <img src={cover} alt={`${title} cover`} decoding="async" fetchPriority="high" style={{ width:"100%",height:"100%",objectFit:"cover",opacity:.8 }} /> : <div className="cover-placeholder" aria-hidden="true"><span className="cover-glyph" style={{ fontSize: 90 }}>{title.charAt(0)}</span></div>}
          <div className="topic-detail-cover-overlay" aria-hidden="true" />
          <div className="topic-detail-cover-copy">
            <div className="eyebrow topic-detail-category">{category || "Collection"}</div>
            <h1 id="topic-detail-title" className="page-title" dir="auto" lang={detectTextLanguage(title)} style={{ margin:"7px 0 4px" }}>{title}</h1>
            {subject.trim() && <div className="topic-detail-subject" dir="auto" lang={detectTextLanguage(subject)}>{subject}</div>}
          </div>
        </div>
        <div className="topic-detail-summary">
          <p className="page-subtitle topic-detail-description" dir="auto" lang={detectTextLanguage(description)}>{description || "A dedicated space for the notes and references in this collection."}</p>
          <div className="topic-detail-actions" role="group" aria-label="Collection actions">
            <TopicImageDownload topicId={id} imageCount={imageCount}/>
            <TopicEditDialog topic={{ id, title, subject, description, category, coverUrl: cover, noteCount: totalNotesIncludingTrash }} />
            <Link href={`/notes/new?topicId=${id}`} className="primary-btn topic-action-button" aria-label="Create a note in this topic" title="Create a note in this topic"><FilePlus size={16}/><span>New note</span></Link>
          </div>
        </div>
      </section>
      <div className="toolbar topic-detail-toolbar">
        <div className="topic-detail-notes-heading">
          <div className="topic-detail-section-heading">
            <h2 id="topic-detail-notes-heading" className="eyebrow">Collection entries</h2>
            <span className="topic-detail-note-count" aria-label={`${totalNotes} of ${totalActiveNotes} notes shown`}>{totalNotes}/{totalActiveNotes}</span>
          </div>
        </div>
        <div className="archive-toolbar-actions">
          <ArchivePinFilter
            basePath={`/topics/${id}`}
            currentFilter={pinFilter}
            preserveQuery={sort === "created-desc" ? "" : `sort=${sort}`}
          />
          <ArchiveSortControl
            basePath={`/topics/${id}`}
            currentSort={sort}
            preserveQuery={pinFilter === "all" ? "" : `pin=${pinFilter}`}
          />
          <Link href="/notes" className="secondary-btn topic-detail-browse-all"><FileText size={15} aria-hidden="true"/><span>Browse all notes</span><ArrowUpRight size={13} aria-hidden="true"/></Link>
        </div>
      </div>
      <section className="panel topic-detail-note-panel" aria-labelledby="topic-detail-notes-heading">
        <div className="note-list topic-detail-note-list">
          {notes.length ? notes.map((note)=><NoteRow key={note.id} note={note} showOpenCue />) : pinFilter !== "all" ? <EmptyState title={pinFilter === "pinned" ? "No pinned notes" : "No unpinned notes"} copy={pinFilter === "pinned" ? "No notes in this collection are pinned yet." : "Every note in this collection is currently pinned."} action={<Link href={`/topics/${id}${sort === "created-desc" ? "" : `?sort=${sort}`}`} className="secondary-btn"><span>Show all notes</span></Link>} /> : <EmptyState title="An open page" copy="This topic has no notes yet. Begin with a thought, a passage or a question you want to explore." action={<Link href={`/notes/new?topicId=${id}`} className="primary-btn topic-detail-first-note"><FilePlus size={16} aria-hidden="true"/><span>Write first note</span></Link>} />}
        </div>
      </section>
      <ArchivePagination
        currentPage={currentPage}
        totalItems={totalNotes}
        basePath={`/topics/${id}`}
        query={[sort === "created-desc" ? "" : `sort=${sort}`, pinFilter === "all" ? "" : `pin=${pinFilter}`].filter(Boolean).join("&") || undefined}
      />
    </main>
  );
}
