"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, MoreHorizontal, Pin, PinOff, Trash2 } from "lucide-react";
import { NoteTopicTransfer } from "@/components/note-topic-transfer";
import { useConfirmation } from "@/components/confirmation-dialog";
import { notifyOperation } from "@/components/operation-status";

export function NoteRowActions({
  noteId,
  currentTopicId,
  pinned,
  compact = false,
}: {
  noteId: string;
  currentTopicId: string;
  pinned: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const { confirm: requestConfirmation, dialog: confirmationDialog } = useConfirmation();
  const [isPinned, setIsPinned] = useState(pinned);
  const [busy, setBusy] = useState<"pin" | "delete" | null>(null);
  const moreActionsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!compact) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !moreActionsRef.current?.contains(event.target)) {
        if (moreActionsRef.current) moreActionsRef.current.open = false;
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !moreActionsRef.current?.open) return;
      event.preventDefault();
      moreActionsRef.current.open = false;
      moreActionsRef.current.querySelector<HTMLElement>("summary")?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [compact]);

  useEffect(() => {
    setIsPinned(pinned);
  }, [pinned]);

  async function togglePinned() {
    if (busy) return;
    setBusy("pin");
    try {
      const nextPinned = !isPinned;
      const response = await fetch(`/api/notes/${noteId}/pin`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ pinned: nextPinned }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not update the pinned state.");
      setIsPinned(nextPinned);
      notifyOperation("success", nextPinned ? "Note pinned." : "Note unpinned.");
      router.refresh();
    } catch (error) {
      notifyOperation("failure", error instanceof Error ? error.message : "Could not update the pinned state.");
    } finally {
      setBusy(null);
    }
  }

  async function moveToTrash() {
    if (busy) return;
    const accepted = await requestConfirmation({
      eyebrow: "Move note to trash",
      title: "Move this note to Recently deleted?",
      description: "You can restore it later. Its encrypted content and images remain until permanent deletion.",
      confirmLabel: "Move to trash",
      tone: "danger",
    });
    if (!accepted) return;

    setBusy("delete");
    try {
      const response = await fetch(`/api/notes/${noteId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not move this note to Recently deleted.");
      notifyOperation("success", "Note moved to Recently deleted.");
      router.refresh();
    } catch (error) {
      notifyOperation("failure", error instanceof Error ? error.message : "Could not move this note to Recently deleted.");
    } finally {
      setBusy(null);
    }
  }

  const pinAction = (
    <button
      type="button"
      className="note-row-action note-row-action-labelled note-row-action--pin"
      onClick={() => void togglePinned()}
      disabled={busy !== null}
      aria-label={isPinned ? "Unpin note" : "Pin note"}
      aria-pressed={isPinned}
      title={isPinned ? "Unpin note" : "Pin note"}
    >
      {busy === "pin" ? <LoaderCircle className="operation-spinner" size={15} aria-hidden="true" /> : isPinned ? <PinOff size={15} aria-hidden="true" /> : <Pin size={15} aria-hidden="true" />}<span>{busy === "pin" ? "Updating…" : isPinned ? "Unpin" : "Pin"}</span>
    </button>
  );
  const trashAction = (
    <button
      type="button"
      className="note-row-action note-row-action-labelled note-row-action--trash"
      onClick={() => void moveToTrash()"
      disabled={busy !== null}
      aria-label="Move note to Recently deleted"
      title="Move note to Recently deleted"
    >
      {busy === "delete" ? <LoaderCircle className="operation-spinner" size={15} aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />}<span>{busy === "delete" ? "Moving…" : "Move to trash"}</span>
    </button>
  );

  return (
    <div className={compact ? "note-row-actions note-row-actions--compact" : "note-row-actions"} role="group" aria-label="Note actions">
      {pinAction}
      {compact ? (
        <details className="note-row-more" ref={moreActionsRef}>
          <summary aria-label="More note actions" title="More note actions"><MoreHorizontal size={18} aria-hidden="true" /></summary>
          <div className="note-row-more-menu" role="group" aria-label="More note actions">
            <NoteTopicTransfer noteId={noteId} currentTopicId={currentTopicId} showLabel />
            {trashAction}
          </div>
        </details>
      ) : (
        <>
          <NoteTopicTransfer noteId={noteId} currentTopicId={currentTopicId} showLabel />
          {trashAction}
        </>
      )}
      {confirmationDialog}
    </div>
  );
}
