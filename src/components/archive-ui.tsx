import Link from "next/link";
import { BookOpen, FileImage, FileText, Pin } from "lucide-react";
import { detectTextLanguage } from "@/lib/bidi";

export type TopicItem = { id: string; title: string; subject: string; description: string; category: string; coverUrl: string | null; noteCount: number; updatedAt: string | Date };
export type NoteItem = { id: string; topicId: string; topicTitle: string; title: string; subject: string; preview?: string; pinned?: boolean; updatedAt: string | Date };

export function TopicCard({ topic }: { topic: TopicItem }) {
  const glyph = topic.title.trim().charAt(0).toUpperCase() || "M";
  return <Link className="topic-card" href={`/topics/${topic.id}`}>
    <div className="topic-cover">{topic.coverUrl ? <img src={topic.coverUrl} alt={`${topic.title} cover`} /> : <div className="cover-placeholder"><span className="cover-glyph">{glyph}</span></div>}<span className="cover-category">{topic.category || "Collection"}</span></div>
    <div className="topic-body"><h2 className="topic-title" dir="auto" lang={detectTextLanguage(topic.title)}>{topic.title}</h2><div className="topic-subject" dir="auto" lang={detectTextLanguage(topic.subject)}>{topic.subject || "A personal collection"}</div><p className="topic-description" dir="auto" lang={detectTextLanguage(topic.description)}>{topic.description || "A place to gather notes, references and ideas worth keeping."}</p><div className="topic-meta"><span className="meta-count"><BookOpen /> {topic.noteCount} {topic.noteCount === 1 ? "note" : "notes"}</span><span>{new Date(topic.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></div></div>
  </Link>;
}

export function NoteRow({ note }: { note: NoteItem }) {
  return <Link href={`/notes/${note.id}`} className={`note-row ${note.pinned ? "note-row-pinned" : ""}`}><div className="note-icon">{note.pinned ? <Pin /> : <FileText />}</div><div className="note-main"><div className="note-row-title" dir="auto" lang={detectTextLanguage(note.title)}>{note.title || "Untitled note"}{note.pinned && <span className="pinned-badge"><Pin /> Pinned</span>}</div><div className="note-row-sub"><span dir="auto" lang={detectTextLanguage(note.topicTitle)}>{note.topicTitle}</span>{note.subject && <> · <span dir="auto" lang={detectTextLanguage(note.subject)}>{note.subject}</span></>}{note.preview && <> · <span dir="auto" lang={detectTextLanguage(note.preview)}>{note.preview}</span></>}</div></div><div className="note-row-meta">{new Date(note.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div></Link>;
}

export function EmptyState({ title, copy, action }: { title: string; copy: string; action?: React.ReactNode }) {
  return <div className="empty-state"><BookOpen /><h3>{title}</h3><p>{copy}</p>{action}</div>;
}

export function ImageCountLabel({ count }: { count: number }) {
  return <span className="meta-count"><FileImage size={13} /> {count} images</span>;
}
