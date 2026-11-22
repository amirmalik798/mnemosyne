"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { FontSelector, ThemeToggle } from "@/components/theme-provider";
import { OperationStatus } from "@/components/operation-status";
import { getResumeDestination } from "@/lib/resume-location";

function AuthFrame({ children, kicker, title, description }: { children: React.ReactNode; kicker: string; title: string; description: string }) {
  return <main className="auth-page"><div className="auth-display-controls"><FontSelector /><ThemeToggle /></div><section className="auth-card">
    <div className="auth-brand"><div className="auth-mark">M</div><div className="eyebrow">{kicker}</div><h1 className="auth-title">{title}</h1><p className="auth-caption">{description}</p></div>
    {children}
  </section></main>;
}

export function VaultSetup() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (password.length < 12) return setError("Use at least 12 characters for your master password.");
    if (password !== confirmation) return setError("Your passwords do not match.");
    setBusy(true);
    try {
      const response = await fetch("/api/vault/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, confirmation }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create your vault.");
      router.replace("/library"); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Setup failed."); }
    finally { setBusy(false); }
  }
  return <AuthFrame kicker="Your private archive" title="Create your vault" description="A quiet place for the ideas you want to keep.">
    <form className="auth-form" onSubmit={submit}>
      <div className="form-field"><label className="form-label" htmlFor="master-password">Master password</label><div style={{ position: "relative" }}><input id="master-password" className="field" type={show ? "text" : "password"} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 12 characters" required minLength={12} style={{ paddingRight: 42 }} /><button type="button" className="icon-button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} style={{ position: "absolute", right: 5, top: 4 }}>{show ? <EyeOff /> : <Eye />}</button></div><span className="form-hint">Use a long, unique passphrase. Mnemosyne cannot recover a forgotten master password without a recovery mechanism.</span></div>
      <div className="form-field"><label className="form-label" htmlFor="confirm-password">Confirm master password</label><input id="confirm-password" className="field" type={show ? "text" : "password"} autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="Enter it again" required /></div>
      {error && <OperationStatus kind="failure" message={error} />}
      <button className="primary-btn" type="submit" disabled={busy} style={{ width: "100%", height: 44, marginTop: 4 }}>{busy ? <LoaderCircle className="operation-spinner" size={16} /> : <ShieldCheck size={16} />}{busy ? "Creating secure vault…" : "Create private vault"}</button>{busy && <OperationStatus kind="loading" message="Generating and securing your private vault…" />}
    </form>
    <div className="auth-foot">Your vault key is generated randomly and wrapped with a key derived from your master password. Keep your password safe.</div>
  </AuthFrame>;
}

export function VaultUnlock() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const response = await fetch("/api/vault/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to unlock the vault.");
      router.replace(getResumeDestination()); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Unlock failed."); }
    finally { setBusy(false); }
  }
  return <AuthFrame kicker="Welcome back" title="Unlock your archive" description="Your notes are waiting, exactly where you left them.">
    <form className="auth-form" onSubmit={submit}>
      <div className="form-field"><label className="form-label" htmlFor="unlock-password">Master password</label><div style={{ position: "relative" }}><input id="unlock-password" className="field" type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your master password" required style={{ paddingRight: 42 }} /><button type="button" className="icon-button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} style={{ position: "absolute", right: 5, top: 4 }}>{show ? <EyeOff /> : <Eye />}</button></div></div>
      {error && <OperationStatus kind="failure" message={error} />}
      <button className="primary-btn" type="submit" disabled={busy} style={{ width: "100%", height: 44, marginTop: 4 }}>{busy ? <LoaderCircle className="operation-spinner" size={16} /> : <KeyRound size={16} />}{busy ? "Unlocking…" : "Unlock Mnemosyne"}</button>{busy && <OperationStatus kind="loading" message="Verifying your password and unlocking the archive…" />}
    </form>
    <div className="auth-foot">This is a single-user private vault. Five consecutive failed password attempts trigger a temporary lockout.</div>
  </AuthFrame>;
}
