"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search, FolderOpen, FileText, ArrowUpRight, X } from "lucide-react";
import { detectTextLanguage } from "@/lib/bidi";
import { OperationStatus } from "@/components/operation-status";

type TopicResult = { id: string; title: string; subject: string; description: string; category: string; coverUrl: string | null; updatedAt: string };
type NoteResult = { id: string; topicId: string; title: string; subject: string; topicTitle: string; tags: string[]; preview: string; updatedAt: string };

export function SearchWorkspace() {
  const [query, setQuery] = useState("");
  const [topics, setTopics] = useState<TopicResult[]>([]);
  const [notes, setNotes] = useState<NoteResult[]>([]);
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      setTopics([]);
      setNotes([]);
      setError("");
      setWaiting(false);
      setBusy(false);
      return;
    }

    const controller = new AbortController();
    setWaiting(true);
    setBusy(false);
    setError("");

    const timer = window.setTimeout(async () => {
      if (controller.signal.aborted) return;
      setWaiting(false);
      setBusy(true);

      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(cleanQuery)}`, {
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Search could not be completed.");

        setTopics(Array.isArray(data.topics) ? data.topics : []);
        setNotes(Array.isArray(data.notes) ? data.notes : []);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Search failed. Check your connection and try again.");
        }
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const resultCount = topics.length + notes.length;
  const searching = waiting || busy;

  return (
    <main className="page" aria-busy={searching}>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Find a thought</div>
          <h1 className="page-title">Search the archive</h1>
          <p className="page-subtitle">Search across topic names, subjects, note titles, tags and the words inside your notes.</p>
        </div>
      </div>

      <div className="archive-search-field">
        <label className="archive-search-label" htmlFor="archive-search-input">Search your archive</label>
        <div className="archive-search-control">
          <Search size={19} aria-hidden="true" />
          <input
            id="archive-search-input"
            autoFocus
            dir="auto"
            lang={detectTextLanguage(query)}
            className="field"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try a phrase, subject, quotation or keyword…"
            aria-label="Search your archive"
            aria-describedby="archive-search-help"
          />
          <span className="archive-search-count" aria-live="polite">
            {searching ? "Searching…" : query.trim() ? `${resultCount} results` : "Ctrl / ⌘ K"}
          </span>
          {query && (
            <button type="button" className="archive-search-clear" onClick={() => setQuery("")} aria-label="Clear search" title="Clear search">
              <X size={15} /> <span>Clear</span>
            </button>
          )}
        </div>
        <p className="archive-search-help" id="archive-search-help">Search topic names, note titles, tags and the words inside your notes. Press Ctrl or ⌘ + K to return here from anywhere.</p>
      </div>

      {waiting && <OperationStatus kind="waiting" message="Preparing your search…" />}
      {busy && <OperationStatus kind="loading" message="Searching your encrypted archive…" />}
      {error && <OperationStatus kind="error" message={error} />}
      {!searching && !error && query.trim() && (
        <OperationStatus
          kind="success"
          message={resultCount === 1 ? "Search complete · 1 result found." : `Search complete · ${resultCount} results found.`}
        />
      )}

      {!query.trim() ? (
        <div className="empty-state" style={{ marginTop: 22 }}>
          <Search />
          <h3>What are you looking for?</h3>
          <p>Search terms are matched against your decrypted archive on the server. Your note content is not stored in a plaintext search index.</p>
        </div>
      ) : !searching && !error ? (
        <>
          <div className="toolbar">
            <div className="eyebrow">Topics · {topics.length}</div>
          </div>
          {topics.length > 0 ? <div className="search-results">
            {topics.map((topic) => (
              <Link href={`/topics/${topic.id}`} className="result-card" key={topic.id}>
                <div className="result-type"><FolderOpen size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 5 }} /> Topic · {topic.category}</div>
                <h3 className="result-title" dir="auto" lang={detectTextLanguage(topic.title)}>{topic.title}</h3>
                <p className="result-copy">
                  <span dir="auto" lang={detectTextLanguage(topic.subject)}>{topic.subject}</span>{" "}
                  <span dir="auto" lang={detectTextLanguage(topic.description)}>{topic.description}</span>
                </p>
                <div className="result-copy" style={{ marginTop: 12 }}>
                  Open collection <ArrowUpRight size={12} style={{ display: "inline", verticalAlign: "middle" }} />
                </div>
              </Link>
            ))}
          </div> : notes.length > 0 ? <p className="search-section-empty">No topics matched this search. Matching notes are shown below.</p> : null}

          <div className="toolbar" style={{ marginTop: 29 }}>
            <div className="eyebrow">Notes · {notes.length}</div>
          </div>
          {notes.length > 0 ? <div className="search-results">
            {notes.map((note) => (
              <Link href={`/notes/${note.id}`} className="result-card" key={note.id}>
                <div className="result-type"><FileText size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 5 }} /> Note · {note.topicTitle}</div>
                <h3 className="result-title" dir="auto" lang={detectTextLanguage(note.title)}>{note.title}</h3>
                <p className="result-copy">
                  <span dir="auto" lang={detectTextLanguage(note.subject)}>{note.subject}</span>{" "}
                  <span dir="auto" lang={detectTextLanguage(note.preview)}>{note.preview}</span>
                </p>
                {note.tags.length > 0 && (
                  <div style={{ marginTop: 9 }}>
                    {note.tags.slice(0, 4).map((tag) => <span className="tag-pill" key={tag}>#{tag}</span>)}
                  </div>
                )}
              </Link>
            ))}
          </div> : topics.length > 0 ? <p className="search-section-empty">No notes matched this search. Matching topics are shown above.</p> : null}

          {resultCount === 0 && (
            <div className="empty-state" style={{ marginTop: 20 }}>
              <h3>No matches found</h3>
              <p>Search completed, but no topics or notes matched “{query.trim()}”. Try a different word or a broader subject.</p>
            </div>
          )}
        </>
      ) : null}
    </main>
  );
}
