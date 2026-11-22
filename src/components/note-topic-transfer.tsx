"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Copy, FolderInput, FolderPlus, LoaderCircle, RefreshCw, X } from "lucide-react";
import { detectTextLanguage } from "@/lib/bidi";
import { OperationStatus, notifyOperation } from "@/components/operation-status";

export type NoteTopicOption = { id: string; title: string };

type Props = {
  noteId: string;
  currentTopicId: string;
  // Editors already have topic options. The reader loads them only when the
  // user opens Move / copy, avoiding an unconditional query on every read.
  topics?: NoteTopicOption[];
  beforeTransfer?: () => Promise<boolean>;
  showLabel?: boolean;
};

export function NoteTopicTransfer({ noteId, currentTopicId, topics, beforeTransfer, showLabel = false }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<"move" | "copy">("move");
  const [destinationTopicId, setDestinationTopicId] = useState("");
  const [availableTopics, setAvailableTopics] = useState<NoteTopicOption[]>(topics ?? []);
  const [topicsLoaded, setTopicsLoaded] = useState(topics !== undefined);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [topicsError, setTopicsError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [processingMessage, setProcessingMessage] = useState("");
  const topicsRequestRef = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  const destinations = useMemo(
    () => availableTopics.filter((topic) => topic.id !== currentTopicId),
    [availableTopics, currentTopicId],
  );

  async function loadTopics() {
    setTopicsLoading(true);
    setTopicsError("");
    topicsRequestRef.current?.abort();
    const controller = new AbortController();
    topicsRequestRef.current = controller;
    try {
      const nextTopics: NoteTopicOption[] = [];
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const response = await fetch(`/api/topics/options?limit=100&offset=${offset}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load destination topics.");
        const pageTopics: NoteTopicOption[] = Array.isArray(data.topics)
          ? data.topics.filter((topic: unknown): topic is NoteTopicOption =>
              Boolean(topic) &&
              typeof topic === "object" &&
              typeof (topic as NoteTopicOption).id === "string" &&
              typeof (topic as NoteTopicOption).title === "string",
            )
          : [];
        nextTopics.push(...pageTopics);
        hasMore = data.pagination?.hasMore === true;
        offset += Number.isSafeInteger(data.pagination?.limit) && data.pagination.limit > 0
          ? data.pagination.limit
          : 100;
      }
      if (controller.signal.aborted || topicsRequestRef.current !== controller) return;
      setAvailableTopics(nextTopics);
      setTopicsLoaded(true);
      setDestinationTopicId(nextTopics.find((topic) => topic.id !== currentTopicId)?.id ?? "");
    } catch (cause) {
      if (!controller.signal.aborted && topicsRequestRef.current === controller) {
        setTopicsError(cause instanceof Error ? cause.message : "Could not load destination topics.");
      }
    } finally {
      if (topicsRequestRef.current === controller) {
        topicsRequestRef.current = null;
        setTopicsLoading(false);
      }
    }
  }

  function openDialog() {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    topicsRequestRef.current?.abort();
    setAction("move");
    setError("");
    setTopicsError("");
    setOpen(true);

    if (topics !== undefined) {
      setAvailableTopics(topics);
      setTopicsLoaded(true);
      setDestinationTopicId(topics.find((topic) => topic.id !== currentTopicId)?.id ?? "");
    } else if (topicsLoaded) {
      setDestinationTopicId(destinations[0]?.id ?? "");
    } else {
      void loadTopics();
    }
  }

  const closeDialog = useCallback(() => {
    if (busyRef.current) return;
    topicsRequestRef.current?.abort();
    topicsRequestRef.current = null;
    setTopicsLoading(false);
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;

    const container = dialogRef.current;
    const frame = window.requestAnimationFrame(() => {
      const focusable = container?.querySelector<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
      );
      focusable?.focus();
    });

    function handleDialogKeys(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (busy) return;
        event.preventDefault();
        event.stopPropagation();
        closeDialog();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = container?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
      );
      if (!focusable?.length || !container) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !container.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleDialogKeys, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleDialogKeys, true);
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    };
  }, [open, closeDialog]);

  async function submit() {
    if (!destinationTopicId || busy || topicsLoading) return;
    setBusy(true);
    setError("");

    try {
      if (beforeTransfer) {
        setProcessingMessage("Saving your latest note changes…");
        const ready = await beforeTransfer();
        if (!ready) throw new Error("Your latest changes could not be saved. Resolve the save issue before moving or copying this note.");
      }

      setProcessingMessage(action === "move" ? "Moving note to the selected topic…" : "Creating an independent copy…");
      const response = await fetch(`/api/notes/${noteId}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, topicId: destinationTopicId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Could not ${action} this note.`);

      notifyOperation("success", action === "move" ? "Note moved successfully." : "A separate copy of the note was created.");
      setOpen(false);
      router.push(`/notes/${data.noteId}`);
      router.refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : `Could not ${action} this note.`;
      setError(message);
    } finally {
      setBusy(false);
      setProcessingMessage("");
    }
  }

  return (
    <>
      <button type="button" className={showLabel ? "secondary-btn reader-action-button" : "secondary-btn icon-only-btn"} onClick={openDialog} aria-haspopup="dialog" aria-expanded={open} aria-label="Move or copy note" title="Move or copy note">
        <ArrowRightLeft size={17} />
        {showLabel && <span>Move / copy</span>}
      </button>
      {open && (
        <div
          className="transfer-backdrop"
          onMouseDown={(event: ReactMouseEvent<HTMLDivElement>) => {
            if (event.target === event.currentTarget && !busy) closeDialog();
          }}
        >
          <section ref={dialogRef} className="transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="transfer-title" aria-describedby="transfer-description" aria-busy={busy || topicsLoading}>
            <header className="transfer-dialog-head">
              <div>
                <div className="eyebrow">Organize your archive</div>
                <h2 id="transfer-title" className="transfer-title">Move or copy note</h2>
                <p id="transfer-description" className="transfer-subtitle">Choose what should happen to this note and where it belongs.</p>
              </div>
              <button type="button" className="transfer-dialog-close dialog-close-button" onClick={closeDialog} disabled={busy} aria-label="Close dialog" title="Close dialog">
                <X size={16} />
              </button>
            </header>

            <div className="transfer-choice-grid" role="group" aria-label="Transfer action">
              <button type="button" className={`transfer-choice ${action === "move" ? "selected" : ""}`} aria-label="Move note" title="Move note" aria-pressed={action === "move"} onClick={() => setAction("move")} disabled={busy}>
                <span className="transfer-choice-icon"><FolderInput size={17} /></span>
                <span className="transfer-choice-copy"><strong>Move note</strong><small>Place this note in a different topic.</small></span>
                <span className="transfer-choice-radio" aria-hidden="true" />
              </button>
              <button type="button" className={`transfer-choice ${action === "copy" ? "selected" : ""}`} aria-label="Copy note" title="Copy note" aria-pressed={action === "copy"} onClick={() => setAction("copy")} disabled={busy}>
                <span className="transfer-choice-icon"><Copy size={17} /></span>
                <span className="transfer-choice-copy"><strong>Copy note</strong><small>Create a separate copy and keep the original here.</small></span>
                <span className="transfer-choice-radio" aria-hidden="true" />
              </button>
            </div>

            <div className="transfer-destination">
              <label className="property-label" htmlFor={`destination-${noteId}`}>Destination topic</label>
              {topicsLoading ? (
                <OperationStatus kind="loading" message="Loading your topics…" />
              ) : topicsError ? (
                <div>
                  <OperationStatus kind="failure" message={topicsError} />
                  <button type="button" className="secondary-btn transfer-retry-button" onClick={() => void loadTopics()}><RefreshCw size={15} aria-hidden="true" /><span>Retry loading topics</span></button>
                </div>
              ) : destinations.length > 0 ? (
                <select
                  id={`destination-${noteId}`}
                  dir="auto"
                  lang={detectTextLanguage(destinations.find((topic) => topic.id === destinationTopicId)?.title ?? "")}
                  className="select-field"
                  value={destinationTopicId}
                  disabled={busy || topicsLoading}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) => setDestinationTopicId(event.target.value)}
                >
                  {destinations.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
                </select>
              ) : (
                <div className="transfer-no-destination">
                  <p>Create another topic before you can move or copy this note to a different collection.</p>
                  <a href="/topics" className="secondary-btn transfer-retry-button"><FolderPlus size={15} aria-hidden="true" /><span>Create a topic</span></a>
                </div>
              )}
              <p className="form-hint">
                {action === "move"
                  ? "The note keeps its images, tags and pinned status. Only its topic changes."
                  : "A new note is created with its text, formatting, tags, pinned status and independent copies of its images."}
              </p>
            </div>

            {busy && <OperationStatus kind="processing" message={processingMessage || "Working…"} />}
            {error && <OperationStatus kind="failure" message={error} />}
            <footer className="transfer-dialog-actions">
              <button type="button" className="secondary-btn transfer-footer-action" onClick={closeDialog} disabled={busy}><X size={16} aria-hidden="true" /><span>Cancel</span></button>
              <button type="button" className="primary-btn transfer-footer-action" onClick={() => void submit()} disabled={busy || topicsLoading || Boolean(topicsError) || !destinationTopicId} aria-label={busy ? processingMessage || "Working" : action === "move" ? "Move note" : "Create copy"} aria-busy={busy}>
                {busy ? <LoaderCircle className="operation-spinner" size={17} aria-hidden="true" /> : action === "move" ? <FolderInput size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}<span>{busy ? processingMessage || "Working…" : action === "move" ? "Move note" : "Create copy"}</span>
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
