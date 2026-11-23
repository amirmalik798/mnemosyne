import Link from "next/link";
import { ArrowUpRight, BookOpen, FileImage, FileText, Pin } from "lucide-react";
import { detectTextLanguage } from "@/lib/bidi";
import { NoteRowActions } from "@/components/note-row-actions";
import { formatArchiveDate } from "@/lib/date-format";

export type TopicItem = { id: string; title: string; subject: string; description: string; category: string; coverUrl: string | null; noteCount: number; updatedAt: string | Date; dateAt?: string | Date; dateLabel?: string };
export type NoteItem = { id: string; topicId: string; topicTitle: string; title: string; subject: string; preview?: string; pinned?: boolean; updatedAt: string | Date; dateAt?: string | Date; dateLabel?: string };

export function TopicCard({ topic, variant = "default" }: { topic: TopicItem; variant?: "default" | "dashboard" | "archive" | "archive-featured" }) {
  const glyph = topic.title.trim().charAt(0).toUpperCase() || "M";
  const archiveCard = variant === "archive" || variant === "archive-featured";
  const collectionCard = variant === "dashboard" || archiveCard;
  const featuredArchiveCard = variant === "archive-featured";
  const title = topic.title.trim() || "Untitled collection";
  const category = topic.category.trim() || (collectionCard ? "Uncategorized" : "Collection");

  return (
    <Link
      className={`topic-card ${variant === "dashboard" ? "topic-card-dashboard" : ""} ${archiveCard ? "topic-card-archive" : ""} ${collectionCard ? "topic-card-collection" : ""} ${featuredArchiveCard ? "topic-card-archive-featured" : ""}`}
      href={`/topics/${topic.id}`}
      aria-label={`Open collection: ${title}`}
      title={`Open collection: ${title}`}
    >
      <div className="topic-cover">
        {topic.coverUrl
          ? <img src={topic.coverUrl} alt={collectionCard ? "" : `${title} cover`} loading="lazy" decoding="async" />
          : <div className="cover-placeholder"><span className="cover-glyph">{glyph}</span></div>}
        <span className="cover-category">{category}</span>
      </div>
      <div className="topic-body">
        <h2 className="topic-title" dir="auto" lang={detectTextLanguage(title)}>{title}</h2>
        {collectionCard ? (
          <>
            {topic.subject.trim()
              ? <div className="topic-subject" dir="auto" lang={detectTextLanguage(topic.subject)}>{topic.subject}</div>
              : <div className="topic-subject topic-card-missing" aria-label="No subject yet">No subject yet</div>}
            {topic.description.trim()
              ? <p className="topic-description" dir="auto" lang={detectTextLanguage(topic.description)}>{topic.description}</p>
              : <p className="topic-description topic-card-missing topic-card-description-missing">No description yet</p>}
            <div className="topic-card-footer">
              <div className="topic-meta">
                <span className="meta-count"><BookOpen aria-hidden="true" /> {topic.noteCount} {topic.noteCount === 1 ? "note" : "notes"}</span>
                <span>{topic.dateLabel ? `${topic.dateLabel} · ` : ""}{formatArchiveDate(topic.dateAt ?? topic.updatedAt)}</span>
              </div>
              <div className="topic-card-open-cue">
                <span>Open collection</span><ArrowUpRight size={16} aria-hidden="true" />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="topic-subject" dir="auto" lang={detectTextLanguage(topic.subject)}>{topic.subject || "A personal collection"}</div>
            <p className="topic-description" dir="auto" lang={detectTextLanguage(topic.description)}>{topic.description || "A place to gather notes, references and ideas worth keeping."}</p>
            <div className="topic-meta">
              <span className="meta-count"><BookOpen aria-hidden="true" /> {topic.noteCount} {topic.noteCount === 1 ? "note" : "notes"}</span>
              <span>{topic.dateLabel ? `${topic.dateLabel} · ` : ""}{formatArchiveDate(topic.dateAt ?? topic.updatedAt)}</span>
            </div>
          </>
        )}
      </div>
    </Link>
  );
}

export function NoteRow({ note, compactActions = true, showOpenCue = false }: { note: NoteItem; compactActions?: boolean; showOpenCue?: boolean }) {
  return (
    <div className={`note-row ${note.pinned ? "note-row-pinned" : ""}`}>
      <Link
        href={`/notes/${note.id}`}
        className="note-row-main-link"
        aria-label={`Open note: ${note.title || "Untitled note"}`}
        title={`Open note: ${note.title || "Untitled note"}`}
      >
        <div className="note-icon">{note.pinned ? <Pin /> : <FileText />}</div>
        <div className="note-main">
          <div className="note-row-title" dir="auto" lang={detectTextLanguage(note.title)}>
            {note.title || "Untitled note"}
            {note.pinned && <span className="pinned-badge"><Pin /> Pinned</span>}
          </div>
          <div className="note-row-sub">
            <span dir="auto" lang={detectTextLanguage(note.topicTitle)}>{note.topicTitle}</span>
            {note.subject && <> · <span dir="auto" lang={detectTextLanguage(note.subject)}>{note.subject}</span></>}
            {note.preview && <> · <span dir="auto" lang={detectTextLanguage(note.preview)}>{note.preview}</span></>}
          </div>
        </div>
        <div className="note-row-meta" title={note.dateLabel ? `${note.dateLabel} date` : undefined}>{note.dateLabel ? `${note.dateLabel} · ` : ""}{formatArchiveDate(note.dateAt ?? note.updatedAt, true)}</div>
        {showOpenCue && (
          <span className="note-row-open-cue" aria-hidden="true">
            <span>Open note</span><ArrowUpRight size={14} />
          </span>
        )}
      </Link>
      <NoteRowActions noteId={note.id} currentTopicId={note.topicId} pinned={Boolean(note.pinned)} compact={compactActions} />
    </div>
  );
}

export function ArchiveIntegrityNotice({ count, itemLabel }: { count: number; itemLabel: string }) {
  if (count <= 0) return null;
  return <section
    className="panel"
    role="alert"
    aria-live="assertive"
    style={{ marginBottom: 24, borderColor: "rgba(227,143,145,.42)" }}
  >
    <div style={{ color: "var(--red)", fontWeight: 600, marginBottom: 8 }}>
      Some encrypted {itemLabel} could not be authenticated
    </div>
    <p className="archive-integrity-copy">
      {count} {itemLabel} {count === 1 ? "record was" : "records were"} skipped because one or more encrypted fields could not be verified. No records were changed or deleted. Do not reset or reinitialize the vault. Check that the original vault settings and master password are being used; if the original vault key was replaced, restore the original vault settings from a trusted backup.
    </p>
  </section>;
}

export function EmptyState({ title, copy, action }: { title: string; copy: string; action?: React.ReactNode }) {
  return <div className="empty-state"><BookOpen /><h3>{title}</h3><p>{copy}</p>{action}</div>;
}

export function ImageCountLabel({ count }: { count: number }) {
  return <span className="meta-count"><FileImage size={13} /> {count} images</span>;
}
