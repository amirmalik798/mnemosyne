"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AtSign, Eye, EyeOff, LoaderCircle, ShieldCheck, UserRound, KeyRound,
  MailCheck, Check, LockKeyhole, Sparkles, ArrowRight, CircleAlert,
} from "lucide-react";
import { FontSelector, ThemeToggle } from "@/components/theme-provider";
import { OperationStatus } from "@/components/operation-status";
import { getResumeDestination } from "@/lib/resume-location";

type FieldErrors = Record<string, string>;

function validateEmail(value: string): string {
  const email = value.trim();
  if (!email) return "Enter your email address.";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
  return "";
}

function validateName(value: string): string {
  const name = value.trim();
  if (!name) return "Enter your name.";
  if (name.length > 80) return "Name must be 80 characters or fewer.";
  if (/[\u0000-\u001f\u007f]/.test(name)) return "Name contains unsupported characters.";
  return "";
}

function validatePassword(value: string): string {
  if (value.length < 16) return "Use at least 16 characters.";
  if (value.length > 256) return "Password must be 256 characters or fewer.";
  if (!value.trim()) return "Password cannot contain only spaces.";
  return "";
}

function AuthFrame({
  children,
  kicker,
  title,
  description,
  mode,
}: {
  children: React.ReactNode;
  kicker: string;
  title: string;
  description: string;
  mode: "login" | "register" | "verify";
}) {
  return (
    <main className="auth-page">
      <div className="auth-backdrop auth-backdrop-one" />
      <div className="auth-backdrop auth-backdrop-two" />
      <div className="auth-display-controls"><FontSelector /><ThemeToggle /></div>
      <section className={`auth-layout auth-layout-${mode}`}>
        <aside className="auth-story" aria-label="About Mnemosyne">
          <Link href="/login" className="auth-story-brand">
            <span className="auth-mark">M</span>
            <span><strong>Mnemosyne</strong><small>THE PRIVATE KNOWLEDGE ARCHIVE</small></span>
          </Link>
          <div className="auth-story-copy">
            <span className="auth-story-kicker"><Sparkles size={13} /> A quieter place for what matters</span>
            <h2>Keep your thoughts.<br /><em>Keep them yours.</em></h2>
            <p>A considered home for your notes, ideas and lasting knowledge — protected by encryption and built around your privacy.</p>
          </div>
          <div className="auth-story-footer">
            <span><LockKeyhole size={14} /> Private by design</span>
            <span><ShieldCheck size={14} /> Encrypted per account</span>
          </div>
          <div className="auth-orbit auth-orbit-large" />
          <div className="auth-orbit auth-orbit-small" />
        </aside>
        <div className="auth-panel">
          <div className="auth-mobile-brand"><span className="auth-mark">M</span><span>MNEMOSYNE</span></div>
          <div className="auth-panel-heading">
            <div className="eyebrow">{kicker}</div>
            <h1 className="auth-title">{title}</h1>
            <p className="auth-caption">{description}</p>
          </div>
          {children}
          <div className="auth-legal">Your archive is private. Your account is yours.</div>
        </div>
      </section>
      <div className="auth-page-bottom"><span>© {new Date().getFullYear()} Mnemosyne</span><span>Thoughtfully private.</span></div>
    </main>
  );
}

function FieldMessage({ id, children }: { id: string; children: React.ReactNode }) {
  if (!children) return null;
  return <span className="auth-field-error" id={id} role="alert"><CircleAlert size={13} />{children}</span>;
}

function PasswordVisibilityButton({ visible, onToggle, disabled = false }: { visible: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="auth-password-toggle" onClick={onToggle} disabled={disabled} aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible}>
      {visible ? <EyeOff size={17} /> : <Eye size={17} />}
    </button>
  );
}

export function AccountRegister() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const passwordChecks = [
    { label: "At least 16 characters", ok: password.length >= 16 },
    { label: "No more than 256 characters", ok: password.length > 0 && password.length <= 256 },
    { label: "Not only whitespace", ok: Boolean(password.trim()) },
    { label: "Confirmation matches", ok: Boolean(confirmation) && password === confirmation },
  ];

  function validate(values = { displayName, email, password, confirmation }): FieldErrors {
    const next: FieldErrors = {};
    const nameError = validateName(values.displayName);
    const emailError = validateEmail(values.email);
    const passwordError = validatePassword(values.password);
    if (nameError) next.displayName = nameError;
    if (emailError) next.email = emailError;
    if (passwordError) next.password = passwordError;
    if (!values.confirmation) next.confirmation = "Confirm your password.";
    else if (values.password !== values.confirmation) next.confirmation = "Your passwords do not match.";
    return next;
  }

  function updateField(field: "displayName" | "email" | "password" | "confirmation", value: string) {
    const values = { displayName, email, password, confirmation, [field]: value };
    if (field === "displayName") setDisplayName(value);
    if (field === "email") setEmail(value);
    if (field === "password") setPassword(value);
    if (field === "confirmation") setConfirmation(value);
    setError("");
    if (touched[field] || submitted) setErrors(validate(values));
    if (field === "password" && (touched.confirmation || submitted)) setErrors(validate(values));
  }

  function touch(field: string) {
    setTouched((previous) => ({ ...previous, [field]: true }));
    setErrors(validate());
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    const nextErrors = validate();
    setErrors(nextErrors);
    setTouched({ displayName: true, email: true, password: true, confirmation: true });
    setError("");
    setMessage("");
    if (Object.keys(nextErrors).length > 0) {
      const first = document.getElementById(`register-${Object.keys(nextErrors)[0]}`);
      first?.focus();
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: displayName.trim(), email: email.trim(), password, confirmation }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Account registration failed.");
      setMessage(data.message || "If this address can be registered, a confirmation email will be sent. If you do not receive one, sign in to request another.");
      setPassword("");
      setConfirmation("");
      setErrors({});
      setTouched({});
      setSubmitted(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Account registration failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame mode="register" kicker="Your private archive" title="Create your account" description="A personal, encrypted space for everything worth keeping.">
      <form className="auth-form" onSubmit={submit} noValidate aria-busy={busy}>
        <div className="auth-field-group">
          <label className="form-label" htmlFor="register-displayName">Your name</label>
          <div className={`auth-input-wrap ${errors.displayName && (touched.displayName || submitted) ? "has-error" : ""}`}>
            <UserRound className="auth-input-icon" size={17} />
            <input id="register-displayName" className="field auth-field" disabled={busy} value={displayName} onChange={(event) => updateField("displayName", event.target.value)} onBlur={() => touch("displayName")} maxLength={80} autoComplete="name" required placeholder="How should we address you?" aria-invalid={Boolean(errors.displayName && (touched.displayName || submitted))} aria-describedby={errors.displayName ? "register-name-error" : undefined} />
          </div>
          <FieldMessage id="register-name-error">{(touched.displayName || submitted) ? errors.displayName : ""}</FieldMessage>
        </div>
        <div className="auth-field-group">
          <label className="form-label" htmlFor="register-email">Email address</label>
          <div className={`auth-input-wrap ${errors.email && (touched.email || submitted) ? "has-error" : ""}`}>
            <AtSign className="auth-input-icon" size={17} />
            <input id="register-email" className="field auth-field" disabled={busy} type="email" inputMode="email" value={email} onChange={(event) => updateField("email", event.target.value)} onBlur={() => touch("email")} maxLength={254} autoComplete="email" required placeholder="you@example.com" aria-invalid={Boolean(errors.email && (touched.email || submitted))} aria-describedby={errors.email ? "register-email-error" : undefined} />
          </div>
          <FieldMessage id="register-email-error">{(touched.email || submitted) ? errors.email : ""}</FieldMessage>
        </div>
        <div className="auth-field-group">
          <label className="form-label" htmlFor="register-password">Create a password</label>
          <div className={`auth-input-wrap auth-password-wrap ${errors.password && (touched.password || submitted) ? "has-error" : ""}`}>
            <KeyRound className="auth-input-icon" size={17} />
            <input id="register-password" className="field auth-field" disabled={busy} type={showPassword ? "text" : "password"} value={password} onChange={(event) => updateField("password", event.target.value)} onBlur={() => touch("password")} minLength={16} maxLength={256} autoComplete="new-password" required placeholder="Create a long, unique passphrase" aria-invalid={Boolean(errors.password && (touched.password || submitted))} aria-describedby="register-password-hint" />
            <PasswordVisibilityButton visible={showPassword} onToggle={() => setShowPassword((value) => !value)} disabled={busy} />
          </div>
          <span className="form-hint" id="register-password-hint">Your passphrase protects your account and unlocks your personal encryption key.</span>
          <div className="auth-password-checks" aria-label="Password requirements">
            {passwordChecks.map((item) => <span key={item.label} className={item.ok ? "is-valid" : ""}><Check size={12} />{item.label}</span>)}
          </div>
          <FieldMessage id="register-password-error">{(touched.password || submitted) ? errors.password : ""}</FieldMessage>
        </div>
        <div className="auth-field-group">
          <label className="form-label" htmlFor="register-confirmation">Confirm password</label>
          <div className={`auth-input-wrap auth-password-wrap ${errors.confirmation && (touched.confirmation || submitted) ? "has-error" : ""}`}>
            <ShieldCheck className="auth-input-icon" size={17} />
            <input id="register-confirmation" className="field auth-field" disabled={busy} type={showPassword ? "text" : "password"} value={confirmation} onChange={(event) => updateField("confirmation", event.target.value)} onBlur={() => touch("confirmation")} autoComplete="new-password" required placeholder="Enter the same passphrase again" aria-invalid={Boolean(errors.confirmation && (touched.confirmation || submitted))} aria-describedby={errors.confirmation ? "register-confirmation-error" : undefined} />
          </div>
          <FieldMessage id="register-confirmation-error">{(touched.confirmation || submitted) ? errors.confirmation : ""}</FieldMessage>
        </div>
        {error && <OperationStatus kind="failure" message={error} />}
        {message && <OperationStatus kind="success" message={message} />}
        {busy && <OperationStatus kind="processing" message="Creating your account and preparing email confirmation…" />}
        <button className="primary-btn auth-submit" type="submit" disabled={busy}>
          {busy ? <LoaderCircle className="operation-spinner" size={17} /> : <ShieldCheck size={17} />}
          {busy ? "Creating your account…" : "Create secure account"}
          {!busy && <ArrowRight size={16} />}
        </button>
      </form>
      <p className="auth-switch">Already have an account? <Link href="/login">Sign in <ArrowRight size={13} /></Link></p>
      <div className="auth-security-note"><LockKeyhole size={14} /><span>Email confirmation is required before your first sign-in. Your vault encryption key is unique to this account.</span></div>
    </AuthFrame>
  );
}

export function AccountLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resending, setResending] = useState(false);

  function validate(values = { email, password }): FieldErrors {
    const next: FieldErrors = {};
    const emailError = validateEmail(values.email);
    if (emailError) next.email = emailError;
    if (!values.password) next.password = "Enter your password.";
    else if (values.password.length > 256) next.password = "Password must be 256 characters or fewer.";
    return next;
  }

  function touch(field: string) {
    setTouched((previous) => ({ ...previous, [field]: true }));
    setErrors(validate());
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setTouched({ email: true, password: true });
    const nextErrors = validate();
    setErrors(nextErrors);
    setError("");
    setMessage("");
    setNeedsVerification(false);
    if (Object.keys(nextErrors).length) {
      document.getElementById(`login-${Object.keys(nextErrors)[0]}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await response.json().catch(() => ({}));
      if (data.error === "EMAIL_NOT_VERIFIED") {
        setNeedsVerification(true);
        setMessage(data.message || "Confirm your email address before signing in.");
        return;
      }
      if (!response.ok) throw new Error(data.error || "Sign-in failed.");
      window.location.replace(getResumeDestination(data.user.id));
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
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not send a verification email.");
      setMessage(data.message || "If the account is eligible, a confirmation email has been sent.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send a verification email.");
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthFrame mode="login" kicker="Welcome back" title="Sign in to Mnemosyne" description="Your private archive is just a moment away.">
      <form className="auth-form auth-login-form" onSubmit={submit} noValidate aria-busy={busy || resending}>
        <div className="auth-field-group">
          <label className="form-label" htmlFor="login-email">Email address</label>
          <div className={`auth-input-wrap ${errors.email && (touched.email || submitted) ? "has-error" : ""}`}>
            <AtSign className="auth-input-icon" size={17} />
            <input id="login-email" className="field auth-field" disabled={busy || resending} type="email" inputMode="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(""); if (touched.email || submitted) setErrors(validate({ email: event.target.value, password })); }} onBlur={() => touch("email")} autoComplete="email" maxLength={254} required placeholder="you@example.com" aria-invalid={Boolean(errors.email && (touched.email || submitted))} aria-describedby={errors.email ? "login-email-error" : undefined} />
          </div>
          <FieldMessage id="login-email-error">{(touched.email || submitted) ? errors.email : ""}</FieldMessage>
        </div>
        <div className="auth-field-group">
          <div className="auth-label-row"><label className="form-label" htmlFor="login-password">Password</label><span className="auth-label-caption">Your account passphrase</span></div>
          <div className={`auth-input-wrap auth-password-wrap ${errors.password && (touched.password || submitted) ? "has-error" : ""}`}>
            <KeyRound className="auth-input-icon" size={17} />
            <input id="login-password" className="field auth-field" disabled={busy || resending} type={showPassword ? "text" : "password"} value={password} onChange={(event) => { setPassword(event.target.value); setError(""); if (touched.password || submitted) setErrors(validate({ email, password: event.target.value })); }} onBlur={() => touch("password")} autoComplete="current-password" maxLength={256} required placeholder="Enter your password" aria-invalid={Boolean(errors.password && (touched.password || submitted))} aria-describedby={errors.password ? "login-password-error" : undefined} />
            <PasswordVisibilityButton visible={showPassword} onToggle={() => setShowPassword((value) => !value)} disabled={busy || resending} />
          </div>
          <FieldMessage id="login-password-error">{(touched.password || submitted) ? errors.password : ""}</FieldMessage>
        </div>
        {error && <OperationStatus kind="failure" message={error} />}
        {message && <OperationStatus kind={needsVerification ? "waiting" : "success"} message={message} />}
        {busy && <OperationStatus kind="processing" message="Verifying your account and unlocking your private archive…" />}
        <button className="primary-btn auth-submit" type="submit" disabled={busy || resending}>
          {busy ? <LoaderCircle className="operation-spinner" size={17} /> : <KeyRound size={17} />}
          {busy ? "Signing you in…" : "Sign in securely"}
          {!busy && <ArrowRight size={16} />}
        </button>
        {resending && <OperationStatus kind="processing" message="Sending a fresh email confirmation link…" />}
        {needsVerification && (
          <button type="button" className="secondary-btn auth-resend" disabled={busy || resending || !email || !password} onClick={resend} aria-busy={resending}>
            {resending ? <LoaderCircle className="operation-spinner" size={15} /> : <MailCheck size={15} />}
            {resending ? "Sending confirmation…" : "Resend confirmation email"}
          </button>
        )}
      </form>
      <p className="auth-switch">New to Mnemosyne? <Link href="/register">Create an account <ArrowRight size={13} /></Link></p>
      <div className="auth-security-note"><ShieldCheck size={14} /><span>Your session is protected with secure, httpOnly cookies. Email verification is required.</span></div>
    </AuthFrame>
  );
}

export function VerifyEmailForm() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [linkLoaded, setLinkLoaded] = useState(false);
  const tokenReadRef = useRef(false);

  useEffect(() => {
    if (tokenReadRef.current) return;
    tokenReadRef.current = true;
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const value = fragment.get("token") ?? "";
    setToken(value);
    window.history.replaceState(window.history.state, "", window.location.pathname);
    setLinkLoaded(true);
  }, []);
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
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Email verification failed.");
      setMessage("Your email address is confirmed. You can now sign in.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Email verification failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame mode="verify" kicker="Account confirmation" title="Verify your email" description="Confirm that you own this email address to activate your account.">
      {!token ? (
        linkLoaded
          ? <OperationStatus kind="failure" message="The verification link does not contain a valid token. Open the complete link from your email or request a new one." />
          : <OperationStatus kind="loading" message="Reading your secure confirmation link…" />
      ) : (
        <div className="auth-form">
          <p className="form-hint">This link can be used once and expires after 24 hours. Verification only activates the account; sign in afterward to unlock your archive.</p>
          {error && <OperationStatus kind="failure" message={error} />}
          {message && <OperationStatus kind="success" message={message} />}
          {busy && <OperationStatus kind="processing" message="Confirming your email address…" />}
          {!message && <button className="primary-btn auth-submit" type="button" onClick={verify} disabled={busy}>
            {busy ? <LoaderCircle className="operation-spinner" size={16} /> : <MailCheck size={16} />}
            {busy ? "Verifying…" : "Confirm email address"}
          </button>}
          {message && <button className="primary-btn auth-submit" type="button" onClick={() => router.replace("/login")}>Continue to sign in</button>}
        </div>
      )}
      <p className="auth-switch"><Link href="/login">Return to sign in <ArrowRight size={13} /></Link></p>
    </AuthFrame>
  );
}
