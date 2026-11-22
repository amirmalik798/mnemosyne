"use client";

import { useState } from "react";
import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { OperationStatus } from "@/components/operation-status";

export function SecuritySettings() {
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword.length < 16) return setError("Use at least 16 characters for your new password.");
    if (newPassword !== confirm) return setError("The new passwords do not match.");

    setBusy(true);
    try {
      const response = await fetch("/api/settings/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not change password.");

      setCurrent("");
      setNew("");
      setConfirm("");
      setSuccess("Your account password has been changed.");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not change password.";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel" style={{ maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 19 }}>
        <div className="note-icon"><ShieldCheck /></div>
        <div>
          <h2 className="panel-title" style={{ margin: 0 }}>Account password</h2>
          <p className="form-hint">Change the password used to unlock your vault.</p>
        </div>
      </div>

      <div className="form-grid">
        <div className="form-field full">
          <label className="form-label" htmlFor="current-master-password">Current password</label>
          <input id="current-master-password" className="field" type="password" value={currentPassword} onChange={(event) => setCurrent(event.target.value)} required autoComplete="current-password" disabled={busy} />
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="new-master-password">New password</label>
          <input id="new-master-password" className="field" type="password" value={newPassword} onChange={(event) => setNew(event.target.value)} required minLength={16} autoComplete="new-password" disabled={busy} />
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="confirm-master-password">Confirm new password</label>
          <input id="confirm-master-password" className="field" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required minLength={16} autoComplete="new-password" disabled={busy} />
        </div>
      </div>

      {busy && <div style={{ marginTop: 13 }}><OperationStatus kind="processing" message="Updating your account password securely…" /></div>}
      {error && <div style={{ marginTop: 13 }}><OperationStatus kind="failure" message={error} /></div>}
      {success && <div style={{ marginTop: 13 }}><OperationStatus kind="success" message={success} /></div>}

      <div className="form-actions">
        <button className="primary-btn icon-only-btn" type="submit" disabled={busy} aria-label={busy ? "Updating account password" : "Change account password"} title={busy ? "Updating account password" : "Change account password"}>
          {busy ? <LoaderCircle className="operation-spinner" size={14} /> : <KeyRound size={14} />}
        </button>
      </div>
    </form>
  );
}
