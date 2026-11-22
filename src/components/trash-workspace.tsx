"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, LoaderCircle, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { OperationStatus, notifyOperation } from "@/components/operation-status";
import { useConfirmation } from "@/components/confirmation-dialog";
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<PendingAction>(null);
  const router = useRouter();
  const { confirm: requestConfirmation, dialog: confirmationDialog } = useConfirmation();

  async function load(append = false) {
    if (append) setLoadingMore(true);
    else {
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
      if (append) setError(message);
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
        title: "Permanently delete this note?",
        description: "This permanently removes the note and its encrypted images. This action cannot be undone.",
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
    <main className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">The archive's safety net</div>
          <h1 className="page-title">Recently deleted</h1>
          <p className="page-subtitle">Notes moved here can be restored or permanently removed.</p>
        </div>
        <div className="stats">
          <div className="stat">
            <strong>{loading ? "—" : totalItems}</strong>
            <span>{loading ? "Loading" : "In trash"}</span>
          </div>
        </div>
      </div>

      {loading && <OperationStatus kind="loading" message="Loading your deleted notes…" />}
      {loadError && (
        <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
          <OperationStatus kind="error" message={loadError} />
          <div><button type="button" className="secondary-btn icon-only-btn" onClick={() => void load()} disabled={loading} aria-label="Retry loading Recently deleted" title="Retry loading Recently deleted"><RefreshCw size={17} /></button></div>
        </div>
      )}
      {error && <OperationStatus kind="failure" message={error} />}
      {busy && <OperationStatus kind="processing" message={busy.action === "restore" ? "Restoring the selected note…" : "Permanently deleting the selected note and its encrypted images…"} />}

      {!loading && !loadError && (
        <section className="panel">
          <div className="note-list">
            {items.length > 0 ? items.map((item) => {
              const pending = busy?.id === item.id;
              const restoring = pending && busy?.action === "restore";
              const deleting = pending && busy?.action === "delete";

              return (
                <div className="note-row note-row-trash" key={item.id}>
                  <div className="note-icon"><Trash2 /></div>
                  <div className="note-main">
                    <div className="note-row-title">{item.title}</div>
                    <div className="note-row-sub">{item.topicTitle}{item.subject ? ` · ${item.subject}` : ""}</div>
                  </div>
                  <div className="note-row-meta"><time dateTime={new Date(item.deletedAt).toISOString()}>Deleted {formatArchiveDate(item.deletedAt, true)}</time></div>
                  <div className="trash-row-actions">
                    <button type="button" className="secondary-btn icon-only-btn" disabled={busy !== null} onClick={() => void action(item.id, "restore")} aria-label={`Restore ${item.title}`} title={`Restore ${item.title}`}>
                      {restoring ? <LoaderCircle className="operation-spinner" size={13} /> : <RotateCcw size={13} />}
                      
                    </button>
                    <button type="button" className="danger-btn icon-only-btn" disabled={busy !== null} onClick={() => void action(item.id, "delete")} aria-label={`Permanently delete ${item.title}`} title="This permanently deletes the note and its encrypted images">
                      {deleting ? <LoaderCircle className="operation-spinner" size={13} /> : <Trash2 size={13} />}
                      
                    </button>
                  </div>
                </div>
              );
            }) : (
              <div className="empty-state">
                <Trash2 />
                <h3>Nothing in Trash</h3>
                <p>There are no deleted notes. Notes you move to Trash will appear here and can be restored before permanent deletion.</p>
              </div>
            )}
          </div>
        </section>
      )}
      {confirmationDialog}
      {!loading && !loadError && hasMore && (
        <div className="archive-pagination-controls" style={{ justifyContent: "center", marginTop: 18 }}>
          {loadingMore && <OperationStatus kind="loading" message="Loading more deleted notes…" compact />}
          <button type="button" className="secondary-btn icon-only-btn" onClick={() => void load(true)} disabled={loadingMore} aria-busy={loadingMore} aria-label={loadingMore ? "Loading more deleted notes" : "Load more deleted notes"} title={loadingMore ? "Loading more deleted notes" : "Load more deleted notes"}>
            {loadingMore ? <LoaderCircle className="operation-spinner" size={17} /> : <ArrowDown size={17} />}
          </button>
        </div>
      )}
    </main>
  );
}
