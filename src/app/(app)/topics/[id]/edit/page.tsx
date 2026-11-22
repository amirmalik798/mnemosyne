import { notFound } from "next/navigation";
import { requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { TopicEditForm } from "@/components/topic-edit-form";
export const dynamic="force-dynamic";
export default async function EditTopicPage({params}:{params:Promise<{id:string}>}){const {id}=await params;const session=await requireVaultSession();const res=await db.query(`SELECT t.*,(SELECT COUNT(*)::int FROM notes n WHERE n.topic_id=t.id) AS note_count FROM topics t WHERE t.id=$1`,[id]);if(!res.rows[0])notFound();const r=res.rows[0];return <TopicEditForm topic={{id,title:decryptText(r.title_enc,session.key),subject:decryptText(r.subject_enc,session.key),description:decryptText(r.description_enc,session.key),category:decryptText(r.category_enc,session.key),coverUrl:r.cover_asset_id?`/api/assets/${r.cover_asset_id}`:null,noteCount:r.note_count}}/>}
