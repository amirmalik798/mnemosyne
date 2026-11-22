import Link from "next/link";
import { FilePlus } from "lucide-react";
import { requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { EmptyState, NoteRow, type NoteItem } from "@/components/archive-ui";
export const dynamic="force-dynamic";
export default async function NotesPage(){const session=await requireVaultSession();const result=await db.query(`SELECT n.*,t.title_enc AS topic_title_enc FROM notes n JOIN topics t ON t.id=n.topic_id WHERE n.deleted_at IS NULL ORDER BY n.pinned DESC,n.updated_at DESC`);const notes:NoteItem[]=result.rows.map(r=>({id:r.id,topicId:r.topic_id,topicTitle:decryptText(r.topic_title_enc,session.key),title:decryptText(r.title_enc,session.key),subject:decryptText(r.subject_enc,session.key),pinned:r.pinned,updatedAt:r.updated_at}));return <main className="page"><div className="page-heading"><div><div className="eyebrow">Your writing</div><h1 className="page-title">All notes</h1><p className="page-subtitle">Every thought and reference, gathered in one searchable place.</p></div><div className="stats"><div className="stat"><strong>{notes.length}</strong><span>Notes</span></div></div></div><section className="panel"><div className="note-list">{notes.length?notes.map(n=><NoteRow key={n.id} note={n}/>):<EmptyState title="No notes yet" copy="Start with a short thought or build a longer reflection in the editor." action={<Link href="/notes/new" className="primary-btn"><FilePlus size={14}/> Create note</Link>}/>}</div></section></main>}
