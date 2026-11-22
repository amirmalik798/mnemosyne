import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Edit3, FilePlus } from "lucide-react";
import { requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { NoteRow, EmptyState, type NoteItem } from "@/components/archive-ui";
import { detectTextLanguage } from "@/lib/bidi";
import { TopicImageDownload } from "@/components/topic-image-download";

type Props = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export default async function TopicPage({ params }: Props) {
  const { id } = await params;
  const session = await requireVaultSession();
  const result = await db.query("SELECT * FROM topics WHERE id=$1", [id]);
  if (!result.rows[0]) notFound();
  const row = result.rows[0];
  const notesResult = await db.query("SELECT * FROM notes WHERE topic_id=$1 AND deleted_at IS NULL ORDER BY pinned DESC,updated_at DESC", [id]);
  const notes: NoteItem[] = notesResult.rows.map((r) => ({ id:r.id,topicId:id,topicTitle:decryptText(row.title_enc,session.key),title:decryptText(r.title_enc,session.key),subject:decryptText(r.subject_enc,session.key),pinned:r.pinned,updatedAt:r.updated_at }));
  const imageIdsByNote = new Map<string, Set<string>>();
  const allImageIds = new Set<string>();
  const collectImageIds = (value: unknown, ids: Set<string>) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach((item) => collectImageIds(item, ids)); return; }
    const record = value as Record<string, unknown>;
    if (record.type === "image" && record.attrs && typeof record.attrs === "object") {
      const src = (record.attrs as Record<string, unknown>).src;
      if (typeof src === "string") {
        const match = src.match(/^\/api\/assets\/([a-f0-9-]{36})$/i);
        if (match) { ids.add(match[1]); allImageIds.add(match[1]); }
      }
    }
    Object.values(record).forEach((item) => collectImageIds(item, ids));
  };
  for (const noteRow of notesResult.rows) {
    const ids = new Set<string>();
    collectImageIds(JSON.parse(decryptText(noteRow.content_enc, session.key)), ids);
    if (ids.size) imageIdsByNote.set(noteRow.id, ids);
  }
  const noteIds = notesResult.rows.map((noteRow) => noteRow.id as string);
  const [imageAssetsResult, coverAssetResult] = await Promise.all([
    allImageIds.size && noteIds.length
      ? db.query(
          "SELECT id, owner_id FROM assets WHERE owner_type='note' AND id=ANY($1::uuid[]) AND owner_id=ANY($2::uuid[])",
          [Array.from(allImageIds), noteIds],
        )
      : Promise.resolve({ rows: [] }),
    row.cover_asset_id
      ? db.query("SELECT id FROM assets WHERE id=$1 AND owner_type='topic' AND owner_id=$2", [row.cover_asset_id, id])
      : Promise.resolve({ rows: [] }),
  ]);
  const validNoteImageCount = imageAssetsResult.rows.filter((asset) =>
    imageIdsByNote.get(asset.owner_id as string)?.has(asset.id as string),
  ).length;
  const imageCount = validNoteImageCount + (coverAssetResult.rows.length ? 1 : 0);
  const title = decryptText(row.title_enc,session.key);
  const subject = decryptText(row.subject_enc,session.key);
  const description = decryptText(row.description_enc,session.key);
  const category = decryptText(row.category_enc,session.key);
  const cover = row.cover_asset_id ? `/api/assets/${row.cover_asset_id}` : null;
  return <main className="page"><div style={{ marginBottom: 19 }}><Link href="/topics" className="breadcrumb"><ArrowLeft size={14}/> All topics</Link></div>
    <section className="panel" style={{ padding: 0, overflow: "hidden", marginBottom: 30 }}><div style={{ height: 220, position: "relative", background: "radial-gradient(circle at 75% 15%,rgba(203,180,126,.22),transparent 35%),linear-gradient(120deg,#263B45,#17232D)" }}>{cover ? <img src={cover} alt={`${title} cover`} style={{ width:"100%",height:"100%",objectFit:"cover",opacity:.8 }} /> : <div className="cover-placeholder"><span className="cover-glyph" style={{ fontSize: 90 }}>{title.charAt(0)}</span></div>}<div style={{ position:"absolute",inset:"45% 0 0",background:"linear-gradient(transparent,rgba(11,16,22,.94))" }}/><div style={{ position:"absolute",left:28,bottom:24 }}><div className="eyebrow">{category || "Collection"}</div><h1 className="page-title" dir="auto" lang={detectTextLanguage(title)} style={{ margin:"7px 0 4px" }}>{title}</h1><div dir="auto" lang={detectTextLanguage(subject)} style={{ fontSize:11,color:"#D0DAD5" }}>{subject}</div></div></div>
      <div style={{ padding:"20px 27px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:15 }}><p className="page-subtitle" dir="auto" lang={detectTextLanguage(description)} style={{ margin:0 }}>{description || "A dedicated space for the notes and references in this collection."}</p><div style={{ display:"flex",gap:8,flexShrink:0,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end" }}><TopicImageDownload topicId={id} topicTitle={title} imageCount={imageCount}/><Link href={`/topics/${id}/edit`} className="secondary-btn"><Edit3 size={14}/> Edit topic</Link><Link href={`/notes/new?topicId=${id}`} className="primary-btn"><FilePlus size={14}/> New note</Link></div></div></section>
    <div className="toolbar"><div><div className="eyebrow">Collection entries</div><h2 className="panel-title" style={{ margin:"7px 0 0" }}>{notes.length} {notes.length===1?"note":"notes"}</h2></div><Link href="/notes" className="secondary-btn">Browse all notes <ArrowUpRight size={14}/></Link></div>
    <section className="panel"><div className="note-list">{notes.length ? notes.map((note)=><NoteRow key={note.id} note={note}/>) : <EmptyState title="An open page" copy="This topic has no notes yet. Begin with a thought, a passage or a question you want to explore." action={<Link href={`/notes/new?topicId=${id}`} className="primary-btn"><FilePlus size={14}/> Write the first note</Link>} />}</div></section>
  </main>;
}
