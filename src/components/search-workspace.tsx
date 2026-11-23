"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, FolderOpen, FileText, ArrowUpRight, X, CheckCircle2, Pin, Tag } from "lucide-react";
import { detectTextLanguage } from "@/lib/bidi";
import { OperationStatus } from "@/components/operation-status";
import { formatArchiveDateTime } from "@/lib/date-format";

type TopicResult = { id: string; title: string; subject: string; description: string; category: string; coverUrl: string | null; updatedAt: string };
type NoteResult = { id: string; topicId: string; title: string; subject: string; topicTitle: string; tags: string[]; pinned: boolean; preview: string; updatedAt: string; matchType?: string };

function HighlightMatch({ value, query }: { value: string; query: string }) {
  const term = query.trim();
  if (!term) return <>{value}</>;
  const lowerValue = value.toLocaleLowerCase();
  const lowerTerm = term.toLocaleLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let found = lowerValue.indexOf(lowerTerm, cursor);
  while (found >= 0) {
    if (found > cursor) parts.push(value.slice(cursor, found));
    parts.push(<mark key={found}>{value.slice(found, found + term.length)}</mark>);
    cursor = found + term.length;
    found = lowerValue.indexOf(lowerTerm, cursor);
  }
  if (!parts.length) return <>{value}</>;
  if (cursor < value.length) parts.push(value.slice(cursor));
  return <>{parts.map((part, index) => <React.Fragment key={index}>{part}</React.Fragment>)}</>;
}

export function SearchWorkspace() {
  const router = useRouter();
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Desktop users benefit from immediate keyboard focus. On touch devices,
    // leave the keyboard closed until the user intentionally taps the field.
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "titles" | "tags" | "pinned">("all");
  const [topics, setTopics] = useState<TopicResult[]>([]);
  const [notes, setNotes] = useState<NoteResult[]>([]);
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

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
        const response = await fetch(`/api/search?q=${encodeURIComponent(cleanQuery)}&scope=${filter}`, {
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
  }, [query, filter, retryCount]);

  const resultCount = topics.length + notes.length;
  const searching = waiting || busy;

  return (
    <main className="page search-archive-page" aria-busy={searching}>
      <header className="search-archive-hero">
        <div className="search-archive-heading">
          <div className="eyebrow">Find a thought · Private archive search</div>
          <h1 className="page-title">Search <em>the archive.</em></h1>
          <p className="page-subtitle">Find a note, recover a phrase or return to an idea. Search across collections, subjects, titles, tags and the words inside your notes.</p>
        </div>
        <aside className="search-privacy-card" aria-label="Search privacy">
          <span className="search-privacy-icon"><Search size={18} aria-hidden="true" /></span>
          <span className="search-privacy-copy">
            <strong>Private by design</strong>
            <small>Your archive is searched in decrypted memory. No plaintext search index is created.</small>
          </span>
        </aside>
      </header>

      <section className="search-archive-panel" aria-label="Search controls">\n      <div className="archive-search-field">
        <label className="archive-search-label" htmlFor="archive-search-input">Search your archive</label>
        <div className="archive-search-control">
          <Search size={19} aria-hidden="true" />
          <input
            id="archive-search-input"
            ref={searchInputRef}
            dir="auto"
            lang={detectTextLanguage(query)}
            className="field"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              if (query.trim()) setQuery("");
              else router.push("/library");
            }}
            placeholder="Try a phrase, subject, quotation or keyword…"
            aria-label="Search your archive"
            aria-describedby="archive-search-help"
          />
          <span className="archive-search-count" aria-live="polite">
            {searching ? "Searching…" : query.trim() ? `${resultCount} results` : "Ctrl / ⌘ K"}
          </span>
          {query && (
            <button type="button" className="archive-search-clear icon-only-btn" onClick={() => setQuery("")} aria-label="Clear search" title="Clear search">
              <X size={17} />
            </button>
          )}
        </div>
        <p className="archive-search-help" id="archive-search-help">Search your decrypted archive without creating a plaintext search index. Choose a scope to narrow the results.</p>
        <div className="archive-search-filters" role="group" aria-label="Search filters">
          {(["all", "titles", "tags", "pinned"] as const).map((value) => (
            <button
              type="button"
              key={value}
              className={filter === value ? "filter-chip active" : "filter-chip"}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === "all" ? "All content" : value === "titles" ? "Titles" : value === "tags" ? "Tags" : "Pinned only"}
            </button>
          ))}
        </div>
        <p className="search-filter-explanation" aria-live="polite">
          {filter === "all"
            ? "Search collection details, note titles, tags and note content."
            : filter === "titles"
              ? "Search note titles and collection names."
              : filter === "tags"
                ? "Find notes by the tags you have assigned."
                : "Search only notes you have pinned."}
        </p>
      </div>
      <div className="search-panel-foot">
        <span><kbd>Esc</kbd> {query.trim() ? "Clear query" : "Return to archive"}</span>
        <span>{query.trim() ? "Results update as you type" : "Start with a word, name or phrase"}</span>
      </div>
      </section>

      {waiting && <OperationStatus kind="waiting" message="Preparing your search…" />}
      {busy && <OperationStatus kind="loading" message="Searching your encrypted archive…" />}
      {error && (
        <div className="search-error-recovery">
          <OperationStatus kind="error" message={error} />
          <button type="button" className="secondary-btn search-retry-button" onClick={() => setRetryCount((value) => value + 1)}>
            <Search size={15} aria-hidden="true" /><span>Retry search</span>
          </button>
        </div>
      )}
      {!searching && !error && query.trim() && (
        <div className="search-result-overview" role="status" aria-live="polite" aria-atomic="true">
          <div className="search-result-overview-copy">
            <span className="search-result-overview-icon"><CheckCircle2 size={17} aria-hidden="true" /></span>
            <span>
              <strong>{resultCount === 1 ? "One match found" : `${resultCount} matches found`}</strong>
              <small>Results for <b dir="auto">“{query.trim()}”</b></small>
            </span>
          </div>
          <div className="search-result-breakdown" aria-label={`${topics.length} collections and ${notes.length} notes`}>
            <span><FolderOpen size={14} aria-hidden="true" /> {topics.length} {topics.length === 1 ? "collection" : "collections"}</span>
            <span><FileText size={14} aria-hidden="true" /> {notes.length} {notes.length === 1 ? "note" : "notes"}</span>
          </div>
        </div>
      )}

      {!query.trim() ? (
        <section className="search-discovery-state" aria-labelledby="search-discovery-title">
          <div className="search-discovery-icon"><Search size={22} aria-hidden="true" /></div>
          <div className="search-discovery-copy">
            <span className="eyebrow">Start anywhere</span>
            <h2 id="search-discovery-title">What do you remember?</h2>
            <p>Enter a word, a phrase you recall, a person or a subject. Search looks inside your decrypted notes as well as their titles and collections.</p>
          </div>
          <div className="search-discovery-examples" aria-label="Things you can search for">
            <span><FileText size={14} aria-hidden="true" /> A passage or quotation</span>
            <span><FolderOpen size={14} aria-hidden="true" /> A collection or subject</span>
            <span><Tag size={14} aria-hidden="true" /> A note tag</span>
          </div>
        </section>
      ) : !searching && !error ? (
        <>
          <section className="search-result-section" aria-labelledby="search-topics-title">
            <div className="search-result-section-heading">
              <div>
                <span className="eyebrow">Collections</span>
                <h2 id="search-topics-title">Matching collections <span>{topics.length}</span></h2>
              </div>
              {topics.length > 0 && <span className="search-section-caption">Open a collection to explore its notes</span>}
            </div>
            {topics.length > 0 ? (
              <div className="search-results">
                {topics.map((topic) => (
                  <Link href={`/topics/${topic.id}`} className="result-card result-card-topic" key={topic.id}>
                    <div className="result-card-topline">
                      <span className="result-type"><FolderOpen size={13} aria-hidden="true" /> Collection</span>
                      <span className="result-card-category">{topic.category || "Uncategorized"}</span>
                    </div>
                    <h3 className="result-title" dir="auto" lang={detectTextLanguage(topic.title)}>
                      <HighlightMatch value={topic.title || "Untitled collection"} query={query} />
                    </h3>
                    {(topic.subject || topic.description) && (
                      <p className="result-copy">
                        {topic.subject && <span className="result-subject" dir="auto" lang={detectTextLanguage(topic.subject)}><HighlightMatch value={topic.subject} query={query} /></span>}
                        {topic.description && <span className="result-description" dir="auto" lang={detectTextLanguage(topic.description)}><HighlightMatch value={topic.description} query={query} /></span>}
                      </p>
                    )}
                    <div className="result-card-footer">
                      <span>Updated {formatArchiveDateTime(topic.updatedAt)}</span>
                      <span className="result-open-cue">Open collection <ArrowUpRight size={14} aria-hidden="true" /></span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : notes.length > 0 ? (
              <div className="search-section-empty">
                No collections matched this phrase. The matching note is listed below, with its passage highlighted.
              </div>
            ) : null}
          </section>

          <section className="search-result-section search-note-section" aria-labelledby="search-notes-title">
            <div className="search-result-section-heading">
              <div>
                <span className="eyebrow">Your writing</span>
                <h2 id="search-notes-title">Matching notes <span>{notes.length}</span></h2>
              </div>
              {notes.length > 0 && <span className="search-section-caption">Select a note to continue reading</span>}
            </div>
            {notes.length > 0 ? (
              <div className="search-results">
                {notes.map((note) => (
                  <Link href={`/notes/${note.id}`} className="result-card result-card-note" key={note.id}>
                    <div className="result-card-topline">
                      <span className="result-type"><FileText size={13} aria-hidden="true" /> Note</span>
                      <span className={`result-match-badge result-match-badge--${note.matchType ?? "content"}`}>
                        {note.matchType === "tag" ? <Tag size={12} aria-hidden="true" /> : note.matchType === "title" ? <FileText size={12} aria-hidden="true" /> : <Search size={12} aria-hidden="true" />}
                        {note.matchType === "tag" ? "Tag match" : note.matchType === "title" ? "Title match" : "Passage match"}
                      </span>
                    </div>
                    <h3 className="result-title" dir="auto" lang={detectTextLanguage(note.title)}>
                      <HighlightMatch value={note.title.trim() || "Untitled note"} query={query} />
                    </h3>
                    <div className="result-note-context">
                      <span dir="auto" lang={detectTextLanguage(note.topicTitle)}>{note.topicTitle || "Unfiled note"}</span>
                      {note.pinned && <span className="result-note-pinned"><Pin size={11} aria-hidden="true" /> Pinned</span>}
                    </div>
                    {note.subject && <p className="result-note-subject" dir="auto" lang={detectTextLanguage(note.subject)}><HighlightMatch value={note.subject} query={query} /></p>}
                    <div className="result-excerpt">
                      <span className="result-excerpt-label">Matched text</span>
                      <p dir="auto" lang={detectTextLanguage(note.preview)}>
                        {note.preview.trim()
                          ? <HighlightMatch value={note.preview.trim()} query={query} />
                          : "Open this note to review its content."}
                      </p>
                    </div>
                    {note.tags.length > 0 && (
                      <div className="result-card-tags">
                        {note.tags.slice(0, 4).map((tag) => <span className="tag-pill" key={tag}>#{tag}</span>)}
                        {note.tags.length > 4 && <span className="result-tags-overflow">+{note.tags.length - 4}</span>}
                      </div>
                    )}
                    <div className="result-card-footer">
                      <span>Updated {formatArchiveDateTime(note.updatedAt)}</span>
                      <span className="result-open-cue">Open note <ArrowUpRight size={14} aria-hidden="true" /></span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : topics.length > 0 ? (
              <div className="search-section-empty">
                No notes matched this phrase. The matching collections are shown above.
              </div>
            ) : null}
          </section>

          {resultCount === 0 && (
            <div className="empty-state search-no-results" style={{ marginTop: 20 }}>
              <Search aria-hidden="true" />
              <h3>No matches found</h3>
              <p>
                Search completed, but no topics or notes matched “{query.trim()}”.
                {filter !== "all" ? " Try searching all content or use a broader phrase." : " Try a different word or a broader subject."}
              </p>
              <div className="search-empty-actions">
                {filter !== "all" && (
                  <button type="button" className="secondary-btn" onClick={() => setFilter("all")}>
                    Show all content
                  </button>
                )}
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => { setQuery(""); setFilter("all"); }}
                >
                  <X size={15} aria-hidden="true" />
                  <span>Clear search</span>
                </button>
              </div>
            </div>
          )}
        </>
      ) : null}
    </main>
  );
}
