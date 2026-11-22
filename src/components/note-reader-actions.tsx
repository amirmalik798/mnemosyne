"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, Trash2 } from "lucide-react";
import { NoteTopicTransfer, type NoteTopicOption } from "@/components/note-topic-transfer";

type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: Node[]; marks?: Array<{type:string;attrs?:Record<string,unknown>}> };
function toMarkdown(node: Node): string {
  if (node.type === "text") {
    let text = node.text ?? "";
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") text = `**${text}**`;
      if (mark.type === "italic") text = `*${text}*`;
      if (mark.type === "strike") text = `~~${text}~~`;
      if (mark.type === "code") text = `\`${text}\``;
      if (mark.type === "link") { const href=String(mark.attrs?.href??""); if(/^https?:\/\//i.test(href)) text=`[${text}](${href})`; }
    }
    return text;
  }
  const inner=(node.content??[]).map(toMarkdown).join("");
  if(node.type==="paragraph")return `${inner}\n\n`;
  if(node.type==="heading"){const level=Math.min(3,Math.max(1,Number(node.attrs?.level??2)));return `${"#".repeat(level)} ${inner}\n\n`;}
  if(node.type==="blockquote")return inner.split("\n").filter(Boolean).map(line=>`> ${line}`).join("\n")+"\n\n";
  if(node.type==="bulletList"||node.type==="orderedList")return inner;
  if(node.type==="listItem")return `- ${inner.trim()}\n`;
  if(node.type==="horizontalRule")return "---\n\n";
  if(node.type==="hardBreak")return "  \n";
  if(node.type==="image"){const src=String(node.attrs?.src??"");const alt=String(node.attrs?.alt??"Image");return src.startsWith("/api/assets/")?`![${alt}](${window.location.origin}${src})\n\n`:"";}
  return inner;
}
export function NoteReaderActions({id,title,content,currentTopicId,topics}:{id:string;title:string;content:unknown;currentTopicId:string;topics:NoteTopicOption[]}){
  const router=useRouter();const [message,setMessage]=useState("");
  function markdown(){const root=content&&typeof content==="object"?content as Node:{content:[]};return `# ${title}\n\n${(root.content??[]).map(toMarkdown).join("")}`.trim()+"\n";}
  async function copy(){try{await navigator.clipboard.writeText(markdown());setMessage("Markdown copied");setTimeout(()=>setMessage(""),1800);}catch{setMessage("Clipboard unavailable");}}
  function exportNote(){const blob=new Blob([markdown()],{type:"text/markdown;charset=utf-8"});const url=URL.createObjectURL(blob);const anchor=document.createElement("a");anchor.href=url;anchor.download=`${title.replace(/[^a-z0-9-_ ]/gi,"").trim().replace(/\s+/g,"-")||"note"}.md`;anchor.click();URL.revokeObjectURL(url);}
  async function remove(){if(!confirm("Move this note to Recently deleted? You can restore it later."))return;const res=await fetch(`/api/notes/${id}`,{method:"DELETE"});if(res.ok){router.push("/notes");router.refresh();}else setMessage("Could not delete note.");}
  return <><NoteTopicTransfer noteId={id} currentTopicId={currentTopicId} topics={topics}/><button className="secondary-btn" onClick={copy}><Copy size={14}/> Copy</button><button className="secondary-btn" onClick={exportNote}><Download size={14}/> Export</button><button className="icon-button" onClick={remove} title="Move to trash" aria-label="Move to trash"><Trash2 size={15}/></button>{message&&<span className="form-hint">{message}</span>}</>;
}
