"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AtSign, Eye, EyeOff, LoaderCircle, ShieldCheck, UserRound, KeyRound, MailCheck } from "lucide-react";
import { FontSelector, ThemeToggle } from "@/components/theme-provider";
import { OperationStatus } from "@/components/operation-status";
import { getResumeDestination } from "@/lib/resume-location";

function AuthFrame({
  children,
  kicker,
  title,
  description,
}: {
  children: React.ReactNode;
  kicker: string;
  title: string;
  description: string;
}) {
  return (
    <main className="auth-page">
      <div className="auth-display-controls"><FontSelector /><ThemeToggle /></div>
      <section className="auth-card">
        <div className="auth-brand">
          <div className="auth-mark">M</div>
          <div className="eyebrow">{kicker}</div>
          <h1 className="auth-title">{title}</h1>
          <p className="auth-caption">{description}</p>
        </div>
        {children}
      </section>
    </main>
  );
}

export function AccountRegister() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (password.length < 16) return setError("Use at least 16 characters for your password.");
    if (password !== confirmation) return setError("Your passwords do not match.");

    setBusy(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, email, password, confirmation }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Account registration failed.");
      setMessage(
        data.emailDelivery === "unavailable"
          ? "Your account has been created, but the confirmation email could not be sent. Configure the Google Apps Script email gateway, then sign in to request another link."
          : data.message || "Check your inbox for the email confirmation link.",
      );
      setPassword("");
      setConfirmation("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Account registration failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame kicker="Your private archive" title="Create your account" description="A separate encrypted archive, reserved for you.">
      <form className="auth-form" onSubmit={submit}>
        <div className="form-field">
          <label className="form-label" htmlFor="account-name">Name</label>
          <div style={{ position: "relative" }}>
            <input id="account-name" className="field" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} autoComplete="name" required placeholder="Your name" style={{ paddingLeft: 38 }} />
            <UserRound size={16} style={{ position: "absolute", left: 12, top: 13, color: "var(--muted)" }} />
          </div>
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="account-email">Email address</label>
          <div style={{ position: "relative" }}>
            <input id="account-email" className="field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} autoComplete="email" required placeholder="you@example.com" style={{ paddingLeft: 38 }} />
            <AtSign size={16} style={{ position: "absolute", left: 12, top: 13, color: "var(--muted)" }} />
          </div>
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="account-password">Password</label>
          <div style={{ position: "relative" }}>
            <input id="account-password" className="field" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={16} maxLength={256} autoComplete="new-password" required placeholder="At least 16 characters" style={{ paddingRight: 44 }} />
            <button type="button" className="icon-button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"} style={{ position: "absolute", right: 5, top: 4 }}>{showPassword ? <EyeOff /> : <Eye />}</button>
          </div>
          <span className="form-hint">Use a unique passphrase. It protects your account and unlocks your personal encryption key.</span>
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="account-confirm-password">Confirm password</label>
          <input id="account-confirm-password" className="field" type={showPassword ? "text" : "password"} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" required />
        </div>
        {error && <OperationStatus kind="failure" message={error} />}
        {message && <OperationStatus kind="success" message={message} />}
        {busy && <OperationStatus kind="loading" message="Creating your account and preparing email confirmation…" />}
        <button className="primary-btn" type="submit" disabled={busy} style={{ width: "100%", height: 44, marginTop: 4 }}>
          {busy ? <LoaderCircle className="operation-spinner" size={16} /> : <ShieldCheck size={16} />}
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
      <div className="auth-foot">You must confirm your email before signing in. Your vault encryption key is unique to this account.</div>
      <p className="auth-foot" style={{ textAlign: "center" }}>Already have an account? <Link href="/login">Sign in</Link></p>
    </AuthFrame>
  );
}

export function AccountLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resending, setResending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    setNeedsVerification(false);
    setBusy(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (data.error === "EMAIL_NOT_VERIFIED") {
        setNeedsVerification(true);
        setMessage(data.message || "Confirm your email address before signing in.");
        return;
      }
      if (!response.ok) throw new Error(data.error || "Sign-in failed.");
      router.replace(getResumeDestination());
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError("");
    setMessage("");
    setResending(true);
    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not send a verification email.");
      setMessage(data.message || "If the account is eligible, a confirmation email has been sent.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send a verification email.");
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthFrame kicker="Welcome back" title="Sign in to Mnemosyne" description="Your private archive is waiting for you.">
      <form className="auth-form" onSubmit={submit}>
        <div className="form-field">
          <label className="form-label" htmlFor="login-email">Email address</label>
          <input id="login-email" className="field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="you@example.com" />
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="login-password">Password</label>
          <div style={{ position: "relative" }}>
            <input id="login-password" className="field" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required style={{ paddingRight: 44 }} />
            <button type="button" className="icon-button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"} style={{ position: "absolute", right: 5, top: 4 }}>{showPassword ? <EyeOff /> : <Eye />}</button>
          </div>
        </div>
        {error && <OperationStatus kind="failure" message={error} />}
        {message && <OperationStatus kind={needsVerification ? "waiting" : "success"} message={message} />}
        {busy && <OperationStatus kind="loading" message="Verifying your account and unlocking your private archive…" />}
        <button className="primary-btn" type="submit" disabled={busy} style={{ width: "100%", height: 44, marginTop: 4 }}>
          {busy ? <LoaderCircle className="operation-spinner" size={16} /> : <KeyRound size={16} />}
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {needsVerification && (
          <button type="button" className="secondary-btn" disabled={resending || !email || !password} onClick={resend} style={{ width: "100%", justifyContent: "center" }}>
            {resending ? <LoaderCircle className="operation-spinner" size={15} /> : <MailCheck size={15} />}
            {resending ? "Sending…" : "Resend confirmation email"}
          </button>
        )}
      </form>
      <p className="auth-foot" style={{ textAlign: "center" }}>New to Mnemosyne? <Link href="/register">Create an account</Link></p>
    </AuthFrame>
  );
}

export function VerifyEmailForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function verify() {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const response = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Email verification failed.");
      setMessage("Your email address is confirmed. You can now sign in.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Email verification failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame kicker="Account confirmation" title="Verify your email" description="Confirm that you own this email address to activate your account.">
      {!token ? (
        <OperationStatus kind="failure" message="The verification link does not contain a token. Open the complete link from your email." />
      ) : (
        <div className="auth-form">
          <p className="form-hint">This link can be used once and expires after 24 hours. Verification only activates the account; sign in afterward to unlock your archive.</p>
          {error && <OperationStatus kind="failure" message={error} />}
          {message && <OperationStatus kind="success" message={message} />}
          {busy && <OperationStatus kind="loading" message="Confirming your email address…" />}
          {!message && <button className="primary-btn" type="button" onClick={verify} disabled={busy} style={{ width: "100%", height: 44 }}>
            {busy ? <LoaderCircle className="operation-spinner" size={16} /> : <MailCheck size={16} />}
            {busy ? "Verifying…" : "Confirm email address"}
          </button>}
          {message && <button className="primary-btn" type="button" onClick={() => router.replace("/login")} style={{ width: "100%", height: 44 }}>Continue to sign in</button>}
        </div>
      )}
      <p className="auth-foot" style={{ textAlign: "center" }}><Link href="/login">Return to sign in</Link></p>
    </AuthFrame>
  );
}
