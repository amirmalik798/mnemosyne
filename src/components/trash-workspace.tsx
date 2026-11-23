"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight, CalendarClock, FileText, LoaderCircle, RefreshCw, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { OperationStatus, notifyOperation } from "@/components/operation-status";
import { useConfirmation } from "@/components/confirmation-dialog";
import { ActionOverflowMenu } from "@/components/action-overflow-menu";
import { formatArchiveDate } from "@/lib/date-format";

type Item = { id: string; title: string; subject: string; topicTitle: string; deletedAt: string };
type PendingAction = { id: string; action: "restore" | "delete" } | null;

export function TrashWorkspace() {
  const [items, setItems] = useState<Item[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadMoreError, setLoadMoreError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<PendingAction>(null);
  const router = useRouter();
  const { confirm: requestConfirmation, dialog: confirmationDialog } = useConfirmation();

  async function load(append = false) {
    if (append) {
      setLoadingMore(true);
      setLoadMoreError("");
    } else {
      setLoading(true);
      setLoadError("");
    }

    try {
      const offset = append ? items.length : 0;
      const response = await fetch(`/api/trash?limit=50&offset=${offset}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load recently deleted notes.");
      const nextItems = Array.isArray(data.notes) ? data.notes : [];
      setItems((current) => append ? [...current, ...nextItems] : nextItems);
      setTotalItems(
        Number.isSafeInteger(data.pagination?.total) ? Number(data.pagination.total) : nextItems.length,
      );
      setHasMore(data.pagination?.hasMore === true);
      if (append) setError("");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not load recently deleted notes.";
      if (append) setLoadMoreError(message);
      else setLoadError(message);
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function action(id: string, actionType: "restore" | "delete") {
    if (busy) return;
    if (actionType === "delete") {
      const accepted = await requestConfirmation({
        eyebrow: "Permanent deletion",
        title: `Permanently delete “${items.find((item) => item.id === id)?.title || "this note"}”?`,
        description: "The note and its encrypted images will be permanently removed. This cannot be undone.",
        confirmLabel: "Delete permanently",
        tone: "danger",
      });
      if (!accepted) return;
    }

    setBusy({ id, action: actionType });
    setError("");
    try {
      const response = await fetch("/api/trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: actionType }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || (actionType === "restore" ? "Could not restore this note." : "Could not permanently delete this note."));

      const successMessage = actionType === "restore"
        ? "Note restored successfully."
        : "Note permanently deleted.";
      notifyOperation("success", successMessage);
      await load();
      router.refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The action could not be completed.";
      setError(message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="page trash-page">
      <header className="trash-page-hero">
        <div className="trash-page-heading">
          <div className="eyebrow">The archive's safety net · Recovery space</div>
          <h1 className="page-title">Recently <em>deleted.</em></h1>
          <p className="page-subtitle">A little room to change your mind. Restore a note to its original collection, or remove it permanently when you are certain.</p>
        </div>
        <aside className="trash-count-card" aria-label={`${loading ? "Loading" : totalItems} notes in Trash`}>
          <span className="trash-count-card-icon"><Trash2 size={18} aria-hidden="true" /></span>
          <span className="trash-count-card-label">Recovery queue</span>
          <span className="trash-count-card-value">{loading ? "—" : totalItems}</span>
          <span className="trash-count-card-caption">{loading ? "Loading deleted notes" : totalItems === 1 ? "note waiting here" : "notes waiting here"}</span>
        </aside>
      </header>

      <section className="trash-guidance" aria-label="How recovery works">
        <div className="trash-guidance-item">
          <span className="trash-guidance-icon trash-guidance-icon-restore"><RotateCcw size={16} aria-hidden="true" /></span>
          <span><strong>Restore</strong><small>Return a note to the collection it came from.</small></span>
        </div>
        <span className="trash-guidance-divider" aria-hidden="true" />
        <div className="trash-guidance-item">
          <span className="trash-guidance-icon trash-guidance-icon-delete"><Trash2 size={16} aria-hidden="true" /></span>
          <span><strong>Delete permanently</strong><small>Remove the note and its encrypted images for good.</small></span>
        </div>
        <span className="trash-guidance-divider" aria-hidden="true" />
        <div className="trash-guidance-item trash-guidance-item-note">
          <span className="trash-guidance-icon trash-guidance-icon-safe"><ShieldCheck size={16} aria-hidden="true" /></span>
          <span><strong>You're in control</strong><small>Permanent deletion always asks you to confirm.</small></span>
        </div>
      </section>

      {loading && <OperationStatus kind="loading" message="Loading your deleted notes…" />}
      {loadError && (
        <div className="trash-load-error">
          <OperationStatus kind="error" message={loadError} />
          <button type="button" className="secondary-btn trash-retry-button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} aria-hidden="true" /><span>Try again</span>
          </button>
        </div>
      )}
      {error && <OperationStatus kind="failure" message={error} />}
      {busy && <OperationStatus kind="processing" message={busy.action === "restore" ? "Restoring the selected note…" : "Permanently deleting the selected note and its encrypted images…"} />}

      {!loading && !loadError && (
        <section className="trash-workspace" aria-labelledby="trash-workspace-title">
          <div className="trash-workspace-heading">
            <div>
              <span className="eyebrow">Your recovery queue</span>
              <h2 id="trash-workspace-title">{totalItems > 0 ? "Notes in Trash" : "Your Trash is clear"}</h2>
              <p>{totalItems > 0 ? "Choose what happens next for each note." : "Nothing needs your attention right now."}</p>
            </div>
            {totalItems > 0 && (
              <span className="trash-workspace-total">
                {items.length} of {totalItems} {totalItems === 1 ? "note" : "notes"}
              </span>
            )}
          </div>

          {items.length > 0 ? (
            <div className="trash-items" aria-label="Recently deleted notes">
              {items.map((item) => {
                const pending = busy?.id === item.id;
                const restoring = pending && busy?.action === "restore";
                const deleting = pending && busy?.action === "delete";

                return (
                  <article className="trash-item-card" key={item.id} aria-busy={pending}>
                    <div className="trash-item-identity">
                      <span className="trash-item-icon"><FileText size={19} aria-hidden="true" /></span>
                      <div className="trash-item-copy">
                        <h3>{item.title || "Untitled note"}</h3>
                        <div className="trash-item-origin">
                          <span className="trash-item-topic">{item.topicTitle || "Original collection"}</span>
                          {item.subject && <span className="trash-item-subject">{item.subject}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="trash-item-date">
                      <CalendarClock size={14} aria-hidden="true" />
                      <span>Moved to Trash</span>
                      <time dateTime={new Date(item.deletedAt).toISOString()}>{formatArchiveDate(item.deletedAt, true)}</time>
                    </div>

                    <div className="trash-item-actions" aria-label={`Actions for ${item.title || "untitled note"}`}>
                      <button type="button" className="primary-btn trash-restore-button" disabled={busy !== null} onClick={() => void action(item.id, "restore")} aria-label={restoring ? `Restoring ${item.title}` : `Restore ${item.title}`} aria-busy={restoring}>
                        {restoring ? <LoaderCircle className="operation-spinner" size={15} aria-hidden="true" /> : <RotateCcw size={15} aria-hidden="true" />}
                        <span>{restoring ? "Restoring…" : "Restore note"}</span>
                        {!restoring && <ArrowRight size={14} aria-hidden="true" />}
                      </button>
                      <ActionOverflowMenu label={`More actions for ${item.title || "untitled note"}`} className="trash-item-overflow">
                        <button type="button" className="danger-btn trash-delete-button" disabled={busy !== null} onClick={() => void action(item.id, "delete")} aria-label={deleting ? `Deleting ${item.title} permanently` : `Permanently delete ${item.title}`} aria-busy={deleting}>
                          {deleting ? <LoaderCircle className="operation-spinner" size={15} aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />}
                          <span>{deleting ? "Deleting…" : "Delete permanently"}</span>
                        </button>
                      </ActionOverflowMenu>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="trash-empty-state" role="region" aria-labelledby="trash-empty-title" aria-describedby="trash-empty-description">
              <div className="trash-empty-art" aria-hidden="true">
                <span className="trash-empty-orbit trash-empty-orbit-one" />
                <span className="trash-empty-orbit trash-empty-orbit-two" />
                <span className="trash-empty-bin"><Trash2 size={30} strokeWidth={1.4} /></span>
                <span className="trash-empty-spark trash-empty-spark-one">✦</span>
                <span className="trash-empty-spark trash-empty-spark-two">✧</span>
              </div>
              <div className="trash-empty-copy">
                <span className="eyebrow">All clear</span>
                <h3 id="trash-empty-title">Nothing to recover.</h3>
                <p id="trash-empty-description">Notes you move to Trash will appear here. You can restore them to their original collection, or permanently delete them when you're certain.</p>
                <Link href="/notes" className="secondary-btn trash-empty-browse">
                  <FileText size={15} aria-hidden="true" /><span>Browse all notes</span><ArrowUpRight size={14} aria-hidden="true" />
                </Link>
              </div>
            </div>
          )}
        </section>
      )}
      {confirmationDialog}
      {!loading && !loadError && hasMore && (
        <div className="trash-load-more">
          {loadMoreError && <OperationStatus kind="failure" message={loadMoreError} />}
          <button type="button" className="secondary-btn trash-load-more-button" onClick={() => void load(true)} disabled={loadingMore} aria-busy={loadingMore}>
            {loadingMore ? <LoaderCircle className="operation-spinner" size={16} aria-hidden="true" /> : <ArrowDown size={16} aria-hidden="true" />}
            <span>{loadingMore ? "Loading more…" : loadMoreError ? "Retry loading notes" : "Load more notes"}</span>
          </button>
        </div>
      )}
    </main>
  );
}
