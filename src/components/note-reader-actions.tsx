"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, LoaderCircle, Trash2 } from "lucide-react";
import { NoteTopicTransfer } from "@/components/note-topic-transfer";
import { OperationStatus, notifyOperation, type OperationStatusKind } from "@/components/operation-status";
import { useConfirmation } from "@/components/confirmation-dialog";

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
export function NoteReaderActions({
  id,
  title,
  content,
  currentTopicId,
}: {
  id: string;
  title: string;
  content: unknown;
  currentTopicId: string;
}) {
  const router = useRouter();
  const { confirm: requestConfirmation, dialog: confirmationDialog } = useConfirmation();
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<OperationStatusKind>("success");
  const [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState(false);

  function markdown() {
    const root = content && typeof content === "object" ? content as Node : { content: [] };
    return `# ${title}\n\n${(root.content ?? []).map(toMarkdown).join("")}`.trim() + "\n";
  }

  async function copy() {
    if (busy || copying) return;
    setCopying(true);
    setMessageKind("processing");
    setMessage("Copying Markdown to the clipboard…");
    try {
      await navigator.clipboard.writeText(markdown());
      setMessageKind("success");
      setMessage("Markdown copied to clipboard.");
    } catch {
      setMessageKind("failure");
      setMessage("Clipboard access was denied. Check your browser permissions and try again.");
    } finally {
      setCopying(false);
    }
  }

  function exportNote() {
    if (busy || copying) return;
    try {
      const blob = new Blob([markdown()], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${title.replace(/[^a-z0-9-_ ]/gi, "").trim().replace(/\s+/g, "-") || "note"}.md`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessageKind("success");
      setMessage("Markdown export started.");
    } catch {
      setMessageKind("failure");
      setMessage("The Markdown file could not be exported. Please try again.");
    }
  }

  async function remove() {
    if (busy || copying) return;
    const accepted = await requestConfirmation({
      eyebrow: "Move note to trash",
      title: "Move this note to Recently deleted?",
      description: "You can restore this note later from Recently deleted. Its content and encrypted images will be retained until you permanently delete it.",
      confirmLabel: "Move to trash",
      tone: "danger",
    });
    if (!accepted) return;
    setBusy(true);
    setMessageKind("processing");
    setMessage("Moving note to Recently deleted…");
    try {
      const response = await fetch(`/api/notes/${id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not move note to Recently deleted.");

      notifyOperation("success", "Note moved to Recently deleted.");
      router.push("/notes");
      router.refresh();
    } catch (cause) {
      const errorMessage = cause instanceof Error ? cause.message : "Could not delete note.";
      setMessageKind("failure");
      setMessage(errorMessage);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <NoteTopicTransfer noteId={id} currentTopicId={currentTopicId} />
      <button type="button" className="secondary-btn" onClick={() => void copy()} disabled={busy || copying} aria-busy={copying}>
        {copying ? <LoaderCircle className="operation-spinner" size={14} /> : <Copy size={14} />} {copying ? "Copying…" : "Copy Markdown"}
      </button>
      <button type="button" className="secondary-btn" onClick={exportNote} disabled={busy || copying}>
        <Download size={14} /> Export Markdown
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={() => void remove()}
        disabled={busy || copying}
        aria-busy={busy}
        title={busy ? "Moving note to Recently deleted…" : "Move to trash"}
        aria-label={busy ? "Moving note to Recently deleted" : "Move to trash"}
      >
        {busy ? <LoaderCircle className="operation-spinner" /> : <Trash2 size={15} />}
      </button>
      {message && <OperationStatus kind={messageKind} message={message} compact />}
      {confirmationDialog}
    </>
  );
}
