import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Edit3 } from "lucide-react";
import { requireVaultSession } from "@/lib/auth";
import { queryAsUser } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { RichContent } from "@/components/rich-content";
import { NoteReaderActions } from "@/components/note-reader-actions";
import { detectTextLanguage } from "@/lib/bidi";
import { NoteImageDownload } from "@/components/note-image-download";
import { formatArchiveDate, formatArchiveDateTime } from "@/lib/date-format";
type RichTextNode = {
  type?: unknown;
  text?: unknown;
  content?: unknown;
};

function countNoteWords(value: unknown): number {
  const textParts: string[] = [];

  function visit(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    const record = node as RichTextNode;
    if (record.type === "text" && typeof record.text === "string") {
      textParts.push(record.text);
    }
    if (Array.isArray(record.content)) visit(record.content);
  }

  visit(value);
  const text = textParts.join(" ").trim();
  return text ? (text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []).length : 0;
}

export const dynamic="force-dynamic";
export default async function NoteReaderPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const session=await requireVaultSession();
  const result = await queryAsUser(session.userId, 
    `SELECT n.id, n.topic_id, n.title_enc, n.subject_enc, n.content_enc, n.tags_enc, n.updated_at,
            t.title_enc AS topic_title_enc
     FROM notes n
     JOIN topics t ON t.id = n.topic_id
     WHERE n.id = $1 AND n.deleted_at IS NULL`,
    [id],
  );
  if(!result.rows[0])notFound();
  const r=result.rows[0];
  const title=decryptText(r.title_enc,session.key);
  const subject=decryptText(r.subject_enc,session.key);
  const tags=JSON.parse(decryptText(r.tags_enc,session.key)) as string[];
  const content=JSON.parse(decryptText(r.content_enc,session.key));
  const topicTitle=decryptText(r.topic_title_enc,session.key);

  type IndexedNote = {
    id: string;
    topicId: string;
    title: string;
    tags: string[];
    text: string;
    links: string[];
    updatedAt: Date | string;
  };
  const connectionRows = await queryAsUser(session.userId,
    `SELECT id, topic_id, title_enc, content_enc, tags_enc, updated_at
     FROM notes
     WHERE deleted_at IS NULL AND id <> $1
     ORDER BY updated_at DESC, id DESC
     LIMIT 1000`,
    [id],
  );
  const noteIndex: IndexedNote[] = [];
  const wikiLinks: Record<string, string> = {};
  const extractPlainText = (root: unknown) => {
    const fragments: string[] = [];
    const pending: unknown[] = [root];
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== "object") continue;
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index -= 1) pending.push(value[index]);
        continue;
      }
      const node = value as Record<string, unknown>;
      if (node.type === "text" && typeof node.text === "string") fragments.push(node.text);
      if (Array.isArray(node.content)) pending.push(node.content);
    }
    return fragments.join(" ").replace(/\s+/g, " ").trim();
  };
  const extractWikiTitles = (value: string) => {
    const found: string[] = [];
    const expression = /\[\[([^\]]+)\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = expression.exec(value)) !== null) {
      const target = match[1].trim().toLocaleLowerCase();
      if (target && !found.includes(target)) found.push(target);
    }
    return found;
  };

  for (const row of connectionRows.rows) {
    try {
      const linkedTitle = decryptText(row.title_enc, session.key);
      const linkedContent = JSON.parse(decryptText(row.content_enc, session.key));
      const decodedTags = JSON.parse(decryptText(row.tags_enc, session.key));
      const linkedTags = Array.isArray(decodedTags)
        ? decodedTags.filter((tag): tag is string => typeof tag === "string").slice(0, 30)
        : [];
      const linkedText = extractPlainText(linkedContent);
      const indexed: IndexedNote = {
        id: String(row.id),
        topicId: String(row.topic_id),
        title: linkedTitle,
        tags: linkedTags,
        text: linkedText,
        links: extractWikiTitles(linkedText),
        updatedAt: row.updated_at,
      };
      noteIndex.push(indexed);
      const titleKey = linkedTitle.trim().toLocaleLowerCase();
      if (titleKey && !wikiLinks[titleKey]) wikiLinks[titleKey] = `/notes/${indexed.id}`;
    } catch {
      // A damaged, unrelated note must not prevent the current note opening.
    }
  }

  const currentTitleKey = title.trim().toLocaleLowerCase();
  if (currentTitleKey) wikiLinks[currentTitleKey] = `/notes/${id}`;
  const currentWikiTitles = new Set(extractWikiTitles(extractPlainText(content)));
  const linkedNotes = noteIndex.filter((note) =>
    currentWikiTitles.has(note.title.trim().toLocaleLowerCase()),
  );
  const backlinks = noteIndex.filter((note) => note.links.includes(currentTitleKey));
  const currentTags = new Set(tags.map((tag) => tag.toLocaleLowerCase()));
  const relatedNotes = noteIndex
    .map((note) => ({
      ...note,
      sharedTags: note.tags.filter((tag) => currentTags.has(tag.toLocaleLowerCase())).length,
    }))
    .filter((note) => note.topicId === String(r.topic_id) || note.sharedTags > 0)
    .sort((a, b) =>
      Number(b.topicId === String(r.topic_id)) - Number(a.topicId === String(r.topic_id)) ||
      b.sharedTags - a.sharedTags ||
      (b.updatedAt instanceof Date ? b.updatedAt.getTime() : new Date(b.updatedAt).getTime()) -
      (a.updatedAt instanceof Date ? a.updatedAt.getTime() : new Date(a.updatedAt).getTime()),
    )
    .slice(0, 6);
  const imageIds = new Set<string>();
  const collectImageIds = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(collectImageIds); return; }
    const record = value as Record<string, unknown>;
    if (record.type === "image" && record.attrs && typeof record.attrs === "object") {
      const src = (record.attrs as Record<string, unknown>).src;
      if (typeof src === "string") {
        const match = src.match(/^\/api\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
        if (match) imageIds.add(match[1]);
      }
    }
    Object.values(record).forEach(collectImageIds);
  };
  collectImageIds(content);
  const imageAssetsResult = imageIds.size
    ? await queryAsUser(session.userId, 
        "SELECT id FROM assets WHERE owner_type='note' AND owner_id=$1 AND id=ANY($2::uuid[])",
        [id, Array.from(imageIds)],
      )
    : { rows: [] };
  const imageCount = imageAssetsResult.rows.length;

  const words = countNoteWords(content);
  const updatedAt = new Date(r.updated_at).toISOString();
  return <main className="page"><div className="reader"><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:33,gap:12,flexWrap:"wrap"}}><Link href={`/topics/${r.topic_id}`} className="breadcrumb"><ArrowLeft size={14}/><span dir="auto" lang={detectTextLanguage(topicTitle)}>{topicTitle}</span></Link><div className="reader-actions" style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}><NoteImageDownload noteId={id} imageCount={imageCount}/><NoteReaderActions id={id} title={title} content={content} currentTopicId={r.topic_id}/><Link className="primary-btn icon-only-btn" href={`/notes/${id}/edit`} aria-label="Edit note" title="Edit note"><Edit3 size={17}/></Link></div></div><header className="reader-header"><div className="eyebrow" dir="auto" lang={detectTextLanguage(topicTitle)}>{topicTitle}</div><h1 className="reader-title" dir="auto" lang={detectTextLanguage(title)}>{title}</h1>{subject&&<p className="page-subtitle" dir="auto" lang={detectTextLanguage(subject)} style={{fontSize:14}}>{subject}</p>}<div className="reader-meta"><time dateTime={updatedAt}>Updated {formatArchiveDateTime(r.updated_at)}</time><span>·</span><span>{words} words approx.</span></div></header><div style={{height:1,background:"linear-gradient(90deg,var(--gold),transparent)",width:65,marginBottom:30}}/><RichContent content={content} wikiLinks={wikiLinks}/>{tags.length>0&&<div style={{marginTop:32,paddingTop:18,borderTop:"1px solid var(--line)"}}><div className="property-label">Tags</div>{tags.map(tag=><span className="tag-pill" dir="auto" lang={detectTextLanguage(tag)} key={tag}>#{tag}</span>)}</div>}{(backlinks.length > 0 || linkedNotes.length > 0 || relatedNotes.length > 0) && (
        <section className="note-connections" aria-label="Connected notes">
          <p className="note-connections-caption">Connections are resolved from your most recent 1,000 active notes.</p>
          {backlinks.length > 0 && (
            <div className="note-connection-group">
              <div className="property-label">Backlinks · {backlinks.length}</div>
              {backlinks.slice(0, 8).map((note) => (
                <Link href={`/notes/${note.id}`} className="note-connection-link" key={note.id}>
                  {note.title}
                  <small>Links to this note</small>
                </Link>
              ))}
            </div>
          )}
          {linkedNotes.length > 0 && (
            <div className="note-connection-group">
              <div className="property-label">Linked notes · {linkedNotes.length}</div>
              {linkedNotes.map((note) => (
                <Link href={`/notes/${note.id}`} className="note-connection-link" key={note.id}>
                  {note.title}
                  <small>Linked from this note</small>
                </Link>
              ))}
            </div>
          )}
          {relatedNotes.length > 0 && (
            <div className="note-connection-group">
              <div className="property-label">Related by topic or tag</div>
              {relatedNotes.map((note) => (
                <Link href={`/notes/${note.id}`} className="note-connection-link" key={note.id}>
                  {note.title}
                  <small>{note.topicId === String(r.topic_id) ? "Same topic" : `${note.sharedTags} shared tag(s)`}</small>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
      <div className="editor-footer"><span>Mnemosyne · Private archive</span><time dateTime={updatedAt}>Saved {formatArchiveDate(r.updated_at, true)}</time></div></div></main>;
}
