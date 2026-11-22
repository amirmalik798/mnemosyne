"use client";

import { useMemo, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Copy, FolderInput, X } from "lucide-react";
import { detectTextLanguage } from "@/lib/bidi";

export type NoteTopicOption = { id: string; title: string };

type Props = {
  noteId: string;
  currentTopicId: string;
  topics: NoteTopicOption[];
  beforeTransfer?: () => Promise<boolean>;
};

export function NoteTopicTransfer({ noteId, currentTopicId, topics, beforeTransfer }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<"move" | "copy">("move");
  const [destinationTopicId, setDestinationTopicId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const destinations = useMemo(
    () => topics.filter((topic) => topic.id !== currentTopicId),
    [topics, currentTopicId],
  );

  function openDialog() {
    setAction("move");
    setDestinationTopicId(destinations[0]?.id ?? "");
    setError("");
    setOpen(true);
  }

  async function submit() {
    if (!destinationTopicId || busy) return;
    setBusy(true);
    setError("");
    try {
      if (beforeTransfer) {
        const ready = await beforeTransfer();
        if (!ready) throw new Error("Save your current changes before moving or copying this note.");
      }
      const response = await fetch(`/api/notes/${noteId}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, topicId: destinationTopicId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Could not ${action} this note.`);
      setOpen(false);
      router.push(`/notes/${data.noteId}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not ${action} this note.`);
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button type="button" className="secondary-btn" onClick={openDialog}>
      <ArrowRightLeft size={14} /> Move / copy
    </button>
    {open && <div className="transfer-backdrop" onMouseDown={(event: ReactMouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
      <section className="transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="transfer-title">
        <header className="transfer-dialog-head">
          <div>
            <div className="eyebrow">Organize your archive</div>
            <h2 id="transfer-title" className="transfer-title">Move or copy note</h2>
            <p className="transfer-subtitle">Choose what should happen to this note and where it belongs.</p>
          </div>
          <button type="button" className="icon-button" onClick={() => setOpen(false)} disabled={busy} aria-label="Close dialog"><X size={16}/></button>
        </header>

        <div className="transfer-choice-grid" role="group" aria-label="Transfer action">
          <button type="button" className={`transfer-choice ${action === "move" ? "selected" : ""}`} aria-pressed={action === "move"} onClick={() => setAction("move")}>
            <span className="transfer-choice-icon"><FolderInput size={17}/></span>
            <span className="transfer-choice-copy"><strong>Move note</strong><small>Relocate the original. It will leave its current topic.</small></span>
            <span className="transfer-choice-radio" aria-hidden="true" />
          </button>
          <button type="button" className={`transfer-choice ${action === "copy" ? "selected" : ""}`} aria-pressed={action === "copy"} onClick={() => setAction("copy")}>
            <span className="transfer-choice-icon"><Copy size={17}/></span>
            <span className="transfer-choice-copy"><strong>Copy note</strong><small>Create a separate duplicate. The original stays where it is.</small></span>
            <span className="transfer-choice-radio" aria-hidden="true" />
          </button>
        </div>

        <div className="transfer-destination">
          <label className="property-label" htmlFor={`destination-${noteId}`}>Destination topic</label>
          {destinations.length > 0 ? <select id={`destination-${noteId}`} dir="auto" lang={detectTextLanguage(destinations.find((topic) => topic.id === destinationTopicId)?.title ?? "")} className="select-field" value={destinationTopicId} onChange={(event: ChangeEvent<HTMLSelectElement>) => setDestinationTopicId(event.target.value)}>
            {destinations.map((topic: NoteTopicOption) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
          </select> : <div className="transfer-no-destination"><p>Create another topic before you can move or copy this note to a different collection.</p><a href="/topics" className="secondary-btn">Create a topic</a></div>}
          <p className="form-hint">{action === "move" ? "The note keeps its images, tags and pinned status. Only its topic changes." : "A new note is created with its text, formatting, tags, pinned status and independent copies of its images."}</p>
        </div>

        {error && <p className="error-text" role="alert">{error}</p>}
        <footer className="transfer-dialog-actions">
          <button type="button" className="secondary-btn" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
          <button type="button" className="primary-btn" onClick={() => void submit()} disabled={busy || !destinationTopicId}>
            {busy ? (action === "move" ? "Moving…" : "Copying…") : action === "move" ? "Move note" : "Create copy"}
          </button>
        </footer>
      </section>
    </div>}
  </>;
}
