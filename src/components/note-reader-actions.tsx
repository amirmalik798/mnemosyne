"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Copy,
  Download,
  FolderOpen,
  LoaderCircle,
  Printer,
  Trash2,
} from "lucide-react";
import { NoteTopicTransfer } from "@/components/note-topic-transfer";
import { NoteImageDownload } from "@/components/note-image-download";
import { OperationStatus, notifyOperation, type OperationStatusKind } from "@/components/operation-status";
import { useConfirmation } from "@/components/confirmation-dialog";
import { noteToMarkdown } from "@/lib/markdown-export";

export function NoteReaderActions({
  id,
  title,
  content,
  currentTopicId,
  imageCount,
  showLabels = false,
}: {
  id: string;
  title: string;
  content: unknown;
  currentTopicId: string;
  imageCount: number;
  showLabels?: boolean;
}) {
  const router = useRouter();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const { confirm: requestConfirmation, dialog: confirmationDialog } = useConfirmation();
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<OperationStatusKind>("success");
  const [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState(false);
  const [preparingPdf, setPreparingPdf] = useState(false);

  const closeMenus = useCallback(() => {
    toolbarRef.current?.querySelectorAll<HTMLDetailsElement>(".reader-action-disclosure[open]")
      .forEach((menu) => { menu.open = false; });
  }, []);

  useEffect(() => {
    const handleOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !toolbarRef.current?.contains(event.target)) {
        closeMenus();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const openMenu = toolbarRef.current?.querySelector<HTMLDetailsElement>(".reader-action-disclosure[open]");
      if (!openMenu) return;
      event.preventDefault();
      event.stopPropagation();
      openMenu.open = false;
      openMenu.querySelector<HTMLElement>("summary")?.focus();
    };
    document.addEventListener("pointerdown", handleOutsidePointer);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointer);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [closeMenus]);

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

  async function exportPdf() {
    if (busy || copying || preparingPdf) return;

    setPreparingPdf(true);
    setMessageKind("processing");
    setMessage("Preparing note for PDF export…");

    try {
      const printableRoot = document.querySelector(".note-reader-page");
      if (!printableRoot) {
        throw new Error("The note could not be prepared for PDF export. Please refresh and try again.");
      }

      const images = Array.from(printableRoot.querySelectorAll<HTMLImageElement>(".reader-content img"));
      await Promise.all(images.map((image) => {
        image.loading = "eager";
        return image.decode().catch(() => undefined);
      }));
      await document.fonts.ready;

      const originalTitle = document.title;
      const safeTitle = title
        .replace(/[\\/:*?"<>|\u0000-\u001F]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120) || "Mnemosyne note";

      document.title = safeTitle;
      let titleRestored = false;
      const restoreTitle = () => {
        if (titleRestored) return;
        titleRestored = true;
        document.title = originalTitle;
      };
      window.addEventListener("afterprint", restoreTitle, { once: true });

      try {
        window.print();
      } catch (error) {
        window.removeEventListener("afterprint", restoreTitle);
        restoreTitle();
        throw error;
      }

      setMessageKind("success");
      setMessage("Print dialog opened. Choose Save as PDF to export this note.");
    } catch (error) {
      setMessageKind("failure");
      setMessage(error instanceof Error ? error.message : "The PDF export could not be prepared. Please try again.");
    } finally {
      setPreparingPdf(false);
    }
  }

  async function remove() {
    if (busy || copying) return;
    const accepted = await requestConfirmation({
      eyebrow: "Move note to trash",
      title: "Move this note to Recently deleted?",
      description: "You can restore this note later from Recently deleted. Its content and encrypted images will be retained until permanent deletion.",
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
    <div className="reader-action-groups" ref={toolbarRef} role="group" aria-label="Note actions">
      <details className="reader-action-disclosure">
        <summary aria-label="Organize note" title="Organize note">
          <FolderOpen size={16} aria-hidden="true" />
          <span>Organize</span>
          <ChevronDown className="reader-action-chevron" size={14} aria-hidden="true" />
        </summary>
        <div className="reader-action-disclosure-panel" role="group" aria-label="Organization actions" onClick={closeMenus}>
          <NoteImageDownload noteId={id} imageCount={imageCount} showLabel />
          <NoteTopicTransfer noteId={id} currentTopicId={currentTopicId} showLabel />
        </div>
      </details>

      <details className="reader-action-disclosure">
        <summary aria-label="Export note" title="Export note">
          <Download size={16} aria-hidden="true" />
          <span>Export</span>
          <ChevronDown className="reader-action-chevron" size={14} aria-hidden="true" />
        </summary>
        <div className="reader-action-disclosure-panel reader-action-export-panel" role="group" aria-label="Export actions" onClick={closeMenus}>
          <button type="button" className="secondary-btn reader-action-button" onClick={() => void copy()} aria-label={copying ? "Copying Markdown" : "Copy Markdown"} title="Copy Markdown" disabled={busy || copying} aria-busy={copying}>
            {copying ? <LoaderCircle className="operation-spinner" size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
            <span>{copying ? "Copying…" : "Copy Markdown"}</span>
          </button>
          <button type="button" className="secondary-btn reader-action-button" onClick={exportNote} aria-label="Export Markdown" title="Export Markdown" disabled={busy || copying}>
            <Download size={16} aria-hidden="true" />
            <span>Export Markdown</span>
          </button>
          <button
            type="button"
            className="secondary-btn reader-action-button reader-action-button--pdf"
            onClick={() => void exportPdf()}
            aria-label={preparingPdf ? "Preparing PDF export" : "Export note as PDF"}
            title={preparingPdf ? "Preparing PDF export…" : "Export as PDF"}
            disabled={busy || copying || preparingPdf}
            aria-busy={preparingPdf}
          >
            {preparingPdf ? <LoaderCircle className="operation-spinner" size={16} aria-hidden="true" /> : <Printer size={16} aria-hidden="true" />}
            <span>{preparingPdf ? "Preparing…" : "Export PDF"}</span>
          </button>
        </div>
      </details>

      <button
        type="button"
        className="reader-trash-action"
        onClick={() => { closeMenus(); void remove(); }}
        disabled={busy || copying}
        aria-busy={busy}
        title={busy ? "Moving note to Recently deleted…" : "Move note to trash"}
        aria-label={busy ? "Moving note to Recently deleted" : "Move note to trash"}
      >
        {busy ? <LoaderCircle className="operation-spinner" size={16} aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
        <span>{busy ? "Moving…" : "Move to trash"}</span>
      </button>

      {message && <OperationStatus kind={messageKind} message={message} compact />}
      {confirmationDialog}
    </div>
  );
}
