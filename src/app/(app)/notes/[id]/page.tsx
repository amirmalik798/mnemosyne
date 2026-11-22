import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Edit3 } from "lucide-react";
import { requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { RichContent } from "@/components/rich-content";
import { NoteReaderActions } from "@/components/note-reader-actions";
import { detectTextLanguage } from "@/lib/bidi";
export const dynamic="force-dynamic";
export default async function NoteReaderPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const session=await requireVaultSession();
  const [result,topicsResult]=await Promise.all([
    db.query(`SELECT n.*,t.title_enc AS topic_title_enc FROM notes n JOIN topics t ON t.id=n.topic_id WHERE n.id=$1 AND n.deleted_at IS NULL`,[id]),
    db.query("SELECT id,title_enc FROM topics ORDER BY updated_at DESC"),
  ]);
  if(!result.rows[0])notFound();
  const r=result.rows[0];
  const title=decryptText(r.title_enc,session.key);
  const subject=decryptText(r.subject_enc,session.key);
  const tags=JSON.parse(decryptText(r.tags_enc,session.key)) as string[];
  const content=JSON.parse(decryptText(r.content_enc,session.key));
  const topicTitle=decryptText(r.topic_title_enc,session.key);
  const topics=topicsResult.rows.map((topic: {id:string;title_enc:Buffer})=>({id:topic.id,title:decryptText(topic.title_enc,session.key)}));
  const plain=JSON.stringify(content);
  const words=plain.replace(/[^\p{L}\p{N}\s]/gu," ").trim().split(/\s+/).filter(Boolean).length;
  return <main className="page"><div className="reader"><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:33,gap:12,flexWrap:"wrap"}}><Link href={`/topics/${r.topic_id}`} className="breadcrumb"><ArrowLeft size={14}/><span dir="auto" lang={detectTextLanguage(topicTitle)}>{topicTitle}</span></Link><div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}><NoteReaderActions id={id} title={title} content={content} currentTopicId={r.topic_id} topics={topics}/><Link className="primary-btn" href={`/notes/${id}/edit`}><Edit3 size={14}/> Edit</Link></div></div><header className="reader-header"><div className="eyebrow" dir="auto" lang={detectTextLanguage(topicTitle)}>{topicTitle}</div><h1 className="reader-title" dir="auto" lang={detectTextLanguage(title)}>{title}</h1>{subject&&<p className="page-subtitle" dir="auto" lang={detectTextLanguage(subject)} style={{fontSize:14}}>{subject}</p>}<div className="reader-meta"><span>Updated {new Date(r.updated_at).toLocaleString()}</span><span>·</span><span>{words} words approx.</span></div></header><div style={{height:1,background:"linear-gradient(90deg,var(--gold),transparent)",width:65,marginBottom:30}}/><RichContent content={content}/>{tags.length>0&&<div style={{marginTop:32,paddingTop:18,borderTop:"1px solid var(--line)"}}><div className="property-label">Tags</div>{tags.map(tag=><span className="tag-pill" dir="auto" lang={detectTextLanguage(tag)} key={tag}>#{tag}</span>)}</div>}<div className="editor-footer"><span>Mnemosyne · Private archive</span><span>Saved {new Date(r.updated_at).toLocaleDateString()}</span></div></div></main>;
}
