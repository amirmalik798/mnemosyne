import { requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { NoteEditor } from "@/components/note-editor";
export const dynamic="force-dynamic";
export default async function NewNotePage({searchParams}:{searchParams:Promise<{topicId?:string}>}){const session=await requireVaultSession();const [{topicId},result]=await Promise.all([searchParams,db.query("SELECT id,title_enc FROM topics ORDER BY updated_at DESC")]);const topics=result.rows.map(r=>({id:r.id as string,title:decryptText(r.title_enc,session.key)}));return <NoteEditor topics={topics} initialNote={undefined} defaultTopicId={topicId}/>}
