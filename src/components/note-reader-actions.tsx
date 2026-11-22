"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, LoaderCircle, Trash2 } from "lucide-react";
import { NoteTopicTransfer } from "@/components/note-topic-transfer";
import { OperationStatus, notifyOperation, type OperationStatusKind } from "@/components/operation-status";
import { useConfirmation } from "@/components/confirmation-dialog";

import { noteToMarkdown } from "@/lib/markdown-export";
export function NoteReaderActions({
  id,
  title,
  content,
  currentTopicId,
  showLabels = false,
}: {
  id: string;
  title: string;
  content: unknown;
  currentTopicId: string;
  showLabels?: boolean;
}) {
  const router = useRouter();
  const { confirm: requestConfirmation, dialog: confirmationDialog } = useConfirmation();
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<OperationStatusKind>("success");
  const [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState(false);

  function markdown() {
    return noteToMarkdown(title, content, window.location.origin);
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
      <NoteTopicTransfer noteId={id} currentTopicId={currentTopicId} showLabel={showLabels} />
      <button type="button" className={showLabels ? "secondary-btn reader-action-button" : "secondary-btn icon-only-btn"} onClick={() => void copy()} aria-label={copying ? "Copying Markdown" : "Copy Markdown"} title={copying ? "Copying Markdown" : "Copy Markdown"} disabled={busy || copying} aria-busy={copying}>
        {copying ? <LoaderCircle className="operation-spinner" size={16} /> : <Copy size={16} />}
        {showLabels && <span>{copying ? "Copying…" : "Copy Markdown"}</span>}
      </button>
      <button type="button" className={showLabels ? "secondary-btn reader-action-button" : "secondary-btn icon-only-btn"} onClick={exportNote} aria-label="Export Markdown" title="Export Markdown" disabled={busy || copying}>
        <Download size={16} />
        {showLabels && <span>Export Markdown</span>}
      </button>
      <button
        type="button"
        className={showLabels ? "icon-button reader-action-button reader-action-button--danger" : "icon-button icon-only-btn"}
        onClick={() => void remove()}
        disabled={busy || copying}
        aria-busy={busy}
        title={busy ? "Moving note to Recently deleted…" : "Move to trash"}
        aria-label={busy ? "Moving note to Recently deleted" : "Move to trash"}
      >
        {busy ? <LoaderCircle className="operation-spinner" /> : <Trash2 size={15} />}
        {showLabels && <span>{busy ? "Moving…" : "Move to trash"}</span>}
      </button>
      {message && <OperationStatus kind={messageKind} message={message} compact />}
      {confirmationDialog}
    </>
  );
}
