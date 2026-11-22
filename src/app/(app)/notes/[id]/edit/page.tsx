import { notFound } from "next/navigation";
import { requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { NoteEditor } from "@/components/note-editor";
export const dynamic="force-dynamic";
export default async function EditNotePage({params}:{params:Promise<{id:string}>}){const {id}=await params;const session=await requireVaultSession();const [topicsResult,noteResult]=await Promise.all([db.query("SELECT id,title_enc FROM topics ORDER BY updated_at DESC"),db.query("SELECT * FROM notes WHERE id=$1 AND deleted_at IS NULL",[id])]);if(!noteResult.rows[0])notFound();const n=noteResult.rows[0];const topics=topicsResult.rows.map(r=>({id:r.id as string,title:decryptText(r.title_enc,session.key)}));return <NoteEditor topics={topics} initialNote={{id:n.id,topicId:n.topic_id,title:decryptText(n.title_enc,session.key),subject:decryptText(n.subject_enc,session.key),content:JSON.parse(decryptText(n.content_enc,session.key)),tags:JSON.parse(decryptText(n.tags_enc,session.key)),pinned:n.pinned}}/>}
