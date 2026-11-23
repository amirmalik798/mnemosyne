import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, BookOpen, Edit3 } from "lucide-react";
import { requireVaultSession } from "@/lib/auth";
import { queryAsUser } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { RichContent } from "@/components/rich-content";
import { NoteReaderActions } from "@/components/note-reader-actions";
import { detectTextLanguage } from "@/lib/bidi";
import { ReaderProgress } from "@/components/reader-progress";
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
    `SELECT n.id, n.topic_id, n.title_enc, n.subject_enc, n.content_enc, n.tags_enc, n.created_at, n.updated_at,
            t.title_enc AS topic_title_enc
     FROM notes n
     JOIN topics t ON t.id = n.topic_id
     WHERE n.id = $1 AND n.deleted_at IS NULL`,
    [id],
  );
  if(!result.rows[0])notFound();
  const r=result.rows[0];

  // Neighbour navigation follows this topic's creation order and only includes
  // active notes owned by the signed-in account.
  const [newerNoteResult, olderNoteResult] = await Promise.all([
    queryAsUser(session.userId,
      `SELECT id, title_enc
       FROM notes
       WHERE topic_id=$1 AND deleted_at IS NULL
         AND (created_at > $2 OR (created_at = $2 AND id > $3))
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
      [r.topic_id, r.created_at, id],
    ),
    queryAsUser(session.userId,
      `SELECT id, title_enc
       FROM notes
       WHERE topic_id=$1 AND deleted_at IS NULL
         AND (created_at < $2 OR (created_at = $2 AND id < $3))
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [r.topic_id, r.created_at, id],
    ),
  ]);
  const newerNote = newerNoteResult.rows[0]
    ? { id: String(newerNoteResult.rows[0].id), title: decryptText(newerNoteResult.rows[0].title_enc, session.key) }
    : null;
  const olderNote = olderNoteResult.rows[0]
    ? { id: String(olderNoteResult.rows[0].id), title: decryptText(olderNoteResult.rows[0].title_enc, session.key) }
    : null;

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
  const readingMinutes = Math.max(1, Math.ceil(words / 220));
  const updatedAt = new Date(r.updated_at).toISOString();

  return (
    <main className="page note-reader-page">
      <div className="reader">
        <ReaderProgress />

        <header className="note-reader-topbar">
          <Link href={`/topics/${r.topic_id}`} className="reader-back-link">
            <ArrowLeft size={16} aria-hidden="true" />
            <span>Back to topic</span>
            <span className="reader-back-divider" aria-hidden="true">/</span>
            <span className="reader-back-topic" dir="auto" lang={detectTextLanguage(topicTitle)}>{topicTitle}</span>
          </Link>
          <div className="reader-topbar-end">
            <span className="reader-mode-pill"><BookOpen size={14} aria-hidden="true" /> Reading</span>
            <Link
              className="primary-btn reader-edit-button"
              href={`/notes/${id}/edit`}
              aria-label="Edit note"
              title="Edit note"
            >
              <Edit3 size={16} aria-hidden="true" />
              <span>Edit note</span>
            </Link>
          </div>
        </header>

        <div className="note-reader-actionbar">
          <NoteReaderActions
            id={id}
            title={title}
            content={content}
            currentTopicId={r.topic_id}
            imageCount={imageCount}
            showLabels
          />
        </div>

        <section className="reader-document" aria-labelledby="reader-note-title">
          <header className="reader-header">
            <div className="reader-topic-kicker">
              <span className="eyebrow">NOTE IN</span>
              <span className="reader-topic-name" dir="auto" lang={detectTextLanguage(topicTitle)}>{topicTitle}</span>
            </div>
            <h1 id="reader-note-title" className="reader-title" dir="auto" lang={detectTextLanguage(title)}>
              {title || "Untitled note"}
            </h1>
            {subject && (
              <p className="page-subtitle reader-subject" dir="auto" lang={detectTextLanguage(subject)}>
                {subject}
              </p>
            )}
            <div className="reader-meta" aria-label="Note details">
              <time dateTime={updatedAt}>Updated {formatArchiveDateTime(r.updated_at)}</time>
              <span aria-hidden="true">·</span>
              <span>{words} {words === 1 ? "word" : "words"}</span>
              {words > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{readingMinutes} min read</span>
                </>
              )}
              {imageCount > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{imageCount} {imageCount === 1 ? "image" : "images"}</span>
                </>
              )}
            </div>
          </header>

          <div className="reader-section-divider" aria-hidden="true" />
          <RichContent content={content} wikiLinks={wikiLinks} />

          {tags.length > 0 && (
            <section className="reader-tags" aria-label="Note tags">
              <div className="property-label">Filed under</div>
              <div className="reader-tag-list">
                {tags.map((tag) => (
                  <span className="tag-pill" dir="auto" lang={detectTextLanguage(tag)} key={tag}>#{tag}</span>
                ))}
              </div>
            </section>
          )}
        </section>

        {(olderNote || newerNote) && (
          <nav className="reader-note-navigation" aria-label="Navigate between notes in this topic">
            {olderNote ? (
              <Link href={`/notes/${olderNote.id}`} className="reader-neighbor-link reader-neighbor-link--older">
                <span className="reader-neighbor-direction"><ArrowLeft size={14} aria-hidden="true" /> Older note</span>
                <strong dir="auto" lang={detectTextLanguage(olderNote.title)}>{olderNote.title || "Untitled note"}</strong>
              </Link>
            ) : (
              <span className="reader-neighbor-empty">First note in this topic</span>
            )}
            {newerNote ? (
              <Link href={`/notes/${newerNote.id}`} className="reader-neighbor-link reader-neighbor-link--newer">
                <span className="reader-neighbor-direction">Newer note <ArrowRight size={14} aria-hidden="true" /></span>
                <strong dir="auto" lang={detectTextLanguage(newerNote.title)}>{newerNote.title || "Untitled note"}</strong>
              </Link>
            ) : (
              <span className="reader-neighbor-empty reader-neighbor-empty--end">Latest note in this topic</span>
            )}
          </nav>
        )}

        {(backlinks.length > 0 || linkedNotes.length > 0 || relatedNotes.length > 0) && (
          <section className="note-connections" aria-label="Connected notes">
            <div className="note-connections-heading">
              <div>
                <span className="eyebrow">YOUR KNOWLEDGE GRAPH</span>
                <h2>Connected notes</h2>
              </div>
              <p className="note-connections-caption">Connections found in your recent active archive.</p>
            </div>
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

        <footer className="editor-footer reader-footer">
          <span>Mnemosyne · Private archive</span>
          <time dateTime={updatedAt}>Saved {formatArchiveDate(r.updated_at, true)}</time>
        </footer>
      </div>
    </main>
  );
}
