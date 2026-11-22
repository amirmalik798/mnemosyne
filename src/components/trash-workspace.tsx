"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
import { OperationStatus, notifyOperation } from "@/components/operation-status";

type Item = { id: string; title: string; subject: string; topicTitle: string; deletedAt: string };
type PendingAction = { id: string; action: "restore" | "delete" } | null;

export function TrashWorkspace() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<PendingAction>(null);
  const router = useRouter();

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/trash");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load recently deleted notes.");
      setItems(Array.isArray(data.notes) ? data.notes : []);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "Could not load recently deleted notes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function action(id: string, actionType: "restore" | "delete") {
    if (busy) return;
    if (actionType === "delete" && !confirm("Permanently delete this note and its encrypted images? This cannot be undone.")) return;

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
            <strong>{loading ? "—" : items.length}</strong>
            <span>{loading ? "Loading" : "In trash"}</span>
          </div>
        </div>
      </div>

      {loading && <OperationStatus kind="loading" message="Loading your deleted notes…" />}
      {loadError && (
        <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
          <OperationStatus kind="error" message={loadError} />
          <div><button type="button" className="secondary-btn" onClick={() => void load()} disabled={loading}>Try again</button></div>
        </div>
      )}
      {error && <OperationStatus kind="failure" message={error} />}

      {!loading && !loadError && (
        <section className="panel">
          <div className="note-list">
            {items.length > 0 ? items.map((item) => {
              const pending = busy?.id === item.id;
              const restoring = pending && busy?.action === "restore";
              const deleting = pending && busy?.action === "delete";

              return (
                <div className="note-row" key={item.id}>
                  <div className="note-icon"><Trash2 /></div>
                  <div className="note-main">
                    <div className="note-row-title">{item.title}</div>
                    <div className="note-row-sub">{item.topicTitle}{item.subject ? ` · ${item.subject}` : ""}</div>
                  </div>
                  <div className="note-row-meta">Deleted {new Date(item.deletedAt).toLocaleDateString()}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="secondary-btn" disabled={busy !== null} onClick={() => void action(item.id, "restore")}>
                      {restoring ? <LoaderCircle className="operation-spinner" size={13} /> : <RotateCcw size={13} />}
                      {restoring ? "Restoring…" : "Restore"}
                    </button>
                    <button className="danger-btn" disabled={busy !== null} onClick={() => void action(item.id, "delete")}>
                      {deleting ? <LoaderCircle className="operation-spinner" size={13} /> : <Trash2 size={13} />}
                      {deleting ? "Deleting…" : "Delete"}
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
    </main>
  );
}
