"use client";

import { useMemo, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Copy, FolderInput, LoaderCircle, X } from "lucide-react";
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
};

export function NoteTopicTransfer({ noteId, currentTopicId, topics, beforeTransfer }: Props) {
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
      setAvailableTopics(nextTopics);
      setTopicsLoaded(true);
      setDestinationTopicId(nextTopics.find((topic) => topic.id !== currentTopicId)?.id ?? "");
    } catch (cause) {
      setTopicsError(cause instanceof Error ? cause.message : "Could not load destination topics.");
    } finally {
      if (topicsRequestRef.current === controller) {
        topicsRequestRef.current = null;
        setTopicsLoading(false);
      }
    }
  }

  function openDialog() {
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
      <button type="button" className="secondary-btn" onClick={openDialog}>
        <ArrowRightLeft size={14} /> Move / copy
      </button>
      {open && (
        <div
          className="transfer-backdrop"
          onMouseDown={(event: ReactMouseEvent<HTMLDivElement>) => {
            if (event.target === event.currentTarget && !busy && !topicsLoading) setOpen(false);
          }}
        >
          <section className="transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="transfer-title">
            <header className="transfer-dialog-head">
              <div>
                <div className="eyebrow">Organize your archive</div>
                <h2 id="transfer-title" className="transfer-title">Move or copy note</h2>
                <p className="transfer-subtitle">Choose what should happen to this note and where it belongs.</p>
              </div>
              <button type="button" className="icon-button" onClick={() => { topicsRequestRef.current?.abort(); setOpen(false); }} disabled={busy || topicsLoading} aria-label="Close dialog">
                <X size={16} />
              </button>
            </header>

            <div className="transfer-choice-grid" role="group" aria-label="Transfer action">
              <button type="button" className={`transfer-choice ${action === "move" ? "selected" : ""}`} aria-pressed={action === "move"} onClick={() => setAction("move")}>
                <span className="transfer-choice-icon"><FolderInput size={17} /></span>
                <span className="transfer-choice-copy"><strong>Move note</strong><small>Relocate the original. It will leave its current topic.</small></span>
                <span className="transfer-choice-radio" aria-hidden="true" />
              </button>
              <button type="button" className={`transfer-choice ${action === "copy" ? "selected" : ""}`} aria-pressed={action === "copy"} onClick={() => setAction("copy")}>
                <span className="transfer-choice-icon"><Copy size={17} /></span>
                <span className="transfer-choice-copy"><strong>Copy note</strong><small>Create a separate duplicate. The original stays where it is.</small></span>
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
                  <button type="button" className="secondary-btn" onClick={() => void loadTopics()}>Retry loading topics</button>
                </div>
              ) : destinations.length > 0 ? (
                <select
                  id={`destination-${noteId}`}
                  dir="auto"
                  lang={detectTextLanguage(destinations.find((topic) => topic.id === destinationTopicId)?.title ?? "")}
                  className="select-field"
                  value={destinationTopicId}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) => setDestinationTopicId(event.target.value)}
                >
                  {destinations.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
                </select>
              ) : (
                <div className="transfer-no-destination">
                  <p>Create another topic before you can move or copy this note to a different collection.</p>
                  <a href="/topics" className="secondary-btn">Create a topic</a>
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
              <button type="button" className="secondary-btn" onClick={() => { topicsRequestRef.current?.abort(); setOpen(false); }} disabled={busy || topicsLoading}>Cancel</button>
              <button type="button" className="primary-btn" onClick={() => void submit()} disabled={busy || topicsLoading || Boolean(topicsError) || !destinationTopicId}>
                {busy
                  ? <><LoaderCircle className="operation-spinner" size={14} /> {processingMessage.includes("Saving") ? "Saving…" : action === "move" ? "Moving…" : "Copying…"}</>
                  : action === "move" ? "Move note" : "Create copy"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
