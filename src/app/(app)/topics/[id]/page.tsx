import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Edit3, FilePlus, FileText } from "lucide-react";
import { requireVaultSession } from "@/lib/auth";
import { queryAsUser } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { NoteRow, EmptyState, type NoteItem } from "@/components/archive-ui";
import { detectTextLanguage } from "@/lib/bidi";
import { TopicImageDownload } from "@/components/topic-image-download";
import { ARCHIVE_PAGE_SIZE, ArchivePagination, parseArchivePage } from "@/components/archive-pagination";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
};
export const dynamic = "force-dynamic";

export default async function TopicPage({ params, searchParams }: Props) {
  const [{ id }, { page: requestedPage }, session] = await Promise.all([
    params,
    searchParams,
    requireVaultSession(),
  ]);
  const requestedPageNumber = parseArchivePage(requestedPage);
  const result = await queryAsUser(session.userId, 
    "SELECT id,title_enc,subject_enc,description_enc,category_enc,cover_asset_id,created_at,updated_at FROM topics WHERE id=$1",
    [id],
  );
  if (!result.rows[0]) notFound();
  const row = result.rows[0];

  const [countResult, coverAssetResult] = await Promise.all([
    queryAsUser(session.userId, "SELECT COUNT(*)::int AS total FROM notes WHERE topic_id=$1 AND deleted_at IS NULL", [id]),
    row.cover_asset_id
      ? queryAsUser(session.userId, "SELECT id FROM assets WHERE id=$1 AND owner_type='topic' AND owner_id=$2", [row.cover_asset_id, id])
      : Promise.resolve({ rows: [] }),
  ]);
  const totalNotes = Number(countResult.rows[0]?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalNotes / ARCHIVE_PAGE_SIZE));
  const currentPage = Math.min(requestedPageNumber, totalPages);
  const notesResult = await queryAsUser(session.userId, 
    `SELECT id,title_enc,subject_enc,pinned,updated_at
     FROM notes
     WHERE topic_id=$1 AND deleted_at IS NULL
     ORDER BY pinned DESC,updated_at DESC,id DESC
     LIMIT $2 OFFSET $3`,
    [id, ARCHIVE_PAGE_SIZE, (currentPage - 1) * ARCHIVE_PAGE_SIZE],
  );
  const topicTitle = decryptText(row.title_enc, session.key);
  const notes: NoteItem[] = notesResult.rows.map((note) => ({
    id: note.id,
    topicId: id,
    topicTitle,
    title: decryptText(note.title_enc, session.key),
    subject: decryptText(note.subject_enc, session.key),
    pinned: note.pinned,
    updatedAt: note.updated_at,
  }));

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
    <main className="page">
      <div style={{ marginBottom: 19 }}>
        <Link href="/topics" className="breadcrumb"><ArrowLeft size={14}/> All topics</Link>
      </div>
      <section className="panel" style={{ padding: 0, overflow: "hidden", marginBottom: 30 }}>
        <div style={{ height: 220, position: "relative", background: "radial-gradient(circle at 75% 15%,rgba(203,180,126,.22),transparent 35%),linear-gradient(120deg,#263B45,#17232D)" }}>
          {cover ? <img src={cover} alt={`${title} cover`} decoding="async" fetchPriority="high" style={{ width:"100%",height:"100%",objectFit:"cover",opacity:.8 }} /> : <div className="cover-placeholder"><span className="cover-glyph" style={{ fontSize: 90 }}>{title.charAt(0)}</span></div>}
          <div style={{ position:"absolute",inset:"45% 0 0",background:"linear-gradient(transparent,rgba(11,16,22,.94))" }}/>
          <div style={{ position:"absolute",left:28,bottom:24 }}>
            <div className="eyebrow">{category || "Collection"}</div>
            <h1 className="page-title" dir="auto" lang={detectTextLanguage(title)} style={{ margin:"7px 0 4px" }}>{title}</h1>
            <div dir="auto" lang={detectTextLanguage(subject)} style={{ fontSize:11,color:"#D0DAD5" }}>{subject}</div>
          </div>
        </div>
        <div className="topic-detail-summary" style={{ padding:"20px 27px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:15 }}>
          <p className="page-subtitle" dir="auto" lang={detectTextLanguage(description)} style={{ margin:0 }}>{description || "A dedicated space for the notes and references in this collection."}</p>
          <div className="topic-detail-actions" style={{ display:"flex",gap:8,flexShrink:0,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end" }}>
            <TopicImageDownload topicId={id} imageCount={imageCount}/>
            <Link href={`/topics/${id}/edit`} className="secondary-btn topic-action-button" aria-label="Edit topic" title="Edit topic"><Edit3 size={16}/><span>Edit topic</span></Link>
            <Link href={`/notes/new?topicId=${id}`} className="primary-btn topic-action-button" aria-label="Create a note in this topic" title="Create a note in this topic"><FilePlus size={16}/><span>New note</span></Link>
          </div>
        </div>
      </section>
      <div className="toolbar">
        <div><div className="eyebrow">Collection entries</div><h2 className="panel-title" style={{ margin:"7px 0 0" }}>{totalNotes} {totalNotes===1?"note":"notes"}</h2></div>
        <Link href="/notes" className="secondary-btn icon-only-btn" aria-label="Browse all notes" title="Browse all notes"><FileText size={17}/></Link>
      </div>
      <section className="panel">
        <div className="note-list">
          {notes.length ? notes.map((note)=><NoteRow key={note.id} note={note}/>) : <EmptyState title="An open page" copy="This topic has no notes yet. Begin with a thought, a passage or a question you want to explore." action={<Link href={`/notes/new?topicId=${id}`} className="primary-btn icon-only-btn" aria-label="Write the first note" title="Write the first note"><FilePlus size={17}/></Link>} />}
        </div>
      </section>
      <ArchivePagination currentPage={currentPage} totalItems={totalNotes} basePath={`/topics/${id}`} />
    </main>
  );
}
