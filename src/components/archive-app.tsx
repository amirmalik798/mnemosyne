"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { EditorContent, useEditor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import ImageExtension from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import {
  AlertCircle, AlignLeft, AlignRight, ArrowDownUp, ArrowLeft, ArrowRight, ArrowUpRight,
  BookOpen, BookText, Bookmark, Bold, Check, CheckCircle2, ChevronDown,
  ChevronRight, Clock3, Code, Copy, Download, Edit3, ExternalLink, Eye,
  FileArchive, FileText, Filter, Folder, FolderPlus, Grid, HelpCircle,
  Image as ImageIcon, ImagePlus, Italic, KeyRound, LayoutDashboard, List,
  ListOrdered, Loader2, Lock, LogOut, Maximize2, Menu, Moon, MoreHorizontal,
  MoreVertical, Pin, Plus, Quote, Redo2, RefreshCw, RotateCcw, Save, Search,
  Settings, Share2, ShieldCheck, Sparkles, Strikethrough, Sun, Tag, Trash2,
  Type, Undo2, Upload, X
} from "lucide-react";
import { noteToMarkdown } from "@/lib/markdown-export";

type UserSession = { userId?: string; id?: string; email: string; displayName: string; expiresAt?: string };
type Topic = {
  id: string; title: string; subject: string; description: string; category: string;
  coverUrl: string | null; noteCount: number; trashedNoteCount?: number; createdAt: string; updatedAt: string;
};
type Note = {
  id: string; topicId: string; topicTitle?: string; title: string; subject: string;
  content: any; tags: string[]; pinned: boolean; createdAt: string; updatedAt: string;
};
type Pagination = { total: number; pinnedCount?: number; offset: number; limit: number; hasMore: boolean };
type SearchResult = {
  id: string; topicId?: string; title: string; subject?: string; topicTitle?: string;
  category?: string; coverUrl?: string | null; tags?: string[]; pinned?: boolean;
  preview?: string; matchType?: string; updatedAt?: string;
};
type ApiResult<T> = T & { error?: string; message?: string };

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

async function apiJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(init.headers || {})
    }
  });
  const raw = await response.text();
  let payload: ApiResult<T> = {} as ApiResult<T>;
  if (raw) {
    try { payload = JSON.parse(raw) as ApiResult<T>; }
    catch { throw new Error("The server returned an unreadable response. Please try again."); }
  }
  if (!response.ok) throw new Error(payload.error || "The request could not be completed.");
  return payload as T;
}

function plainText(value: any): string {
  if (!value) return "";
  if (Array.isArray(value)) return value.map(plainText).filter(Boolean).join(" ");
  if (typeof value !== "object") return "";
  if (value.type === "text") return typeof value.text === "string" ? value.text : "";
  if (value.type === "hardBreak") return " ";
  return Array.isArray(value.content) ? value.content.map(plainText).filter(Boolean).join(" ") : "";
}

function formatDate(value?: string, includeTime = false): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }).format(date);
}

function relativeDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
  if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
  if (seconds < 604800) return Math.floor(seconds / 86400) + "d ago";
  return formatDate(value);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function saveMarkdown(title: string, content: any) {
  const markdown = noteToMarkdown(title || "Untitled note", content || EMPTY_DOC, window.location.origin);
  const safe = (title || "untitled-note").normalize("NFKC").replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 80) || "untitled-note";
  downloadBlob(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), safe + ".md");
}

const DirectionExtension = Extension.create({
  name: "mnemosyneTextDirection",
  addGlobalAttributes() {
    return [{
      types: ["paragraph", "heading"],
      attributes: {
        dir: {
          default: "ltr",
          parseHTML: (element: HTMLElement) => element.getAttribute("dir") || "ltr",
          renderHTML: (attributes: Record<string, unknown>) => attributes.dir === "rtl" ? { dir: "rtl" } : {}
        }
      }
    }];
  }
});

function editorExtensions() {
  return [
    StarterKit,
    ImageExtension.configure({ inline: false, allowBase64: false }),
    Placeholder.configure({ placeholder: "Begin with a thought. Let the connections emerge…" }),
    DirectionExtension
  ];
}

function ActionButton(props: {
  children: ReactNode; onClick?: () => void; title: string; variant?: "primary" | "quiet" | "danger" | "outline";
  disabled?: boolean; type?: "button" | "submit";
}) {
  return (
    <button className={"action-button " + (props.variant || "quiet")} type={props.type || "button"}
      title={props.title} aria-label={props.title} onClick={props.onClick} disabled={props.disabled}>
      {props.children}
    </button>
  );
}

function EmptyState(props: { icon: React.ReactNode; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{props.icon}</div>
      <h3>{props.title}</h3>
      <p>{props.description}</p>
      {props.action}
    </div>
  );
}

function PageHeading(props: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        {props.eyebrow && <div className="eyebrow">{props.eyebrow}</div>}
        <h1>{props.title}</h1>
        {props.description && <p>{props.description}</p>}
      </div>
      {props.action && <div className="page-heading-action">{props.action}</div>}
    </div>
  );
}

function StatusDot() {
  return <span className="status-dot" aria-hidden="true" />;
}

function AuthPage(props: { mode: "login" | "register"; onAuthenticated: (user: UserSession) => void }) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [verifyNeeded, setVerifyNeeded] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(""); setNotice(""); setBusy(true);
    try {
      if (props.mode === "register") {
        if (password.length < 16) throw new Error("Use a password of at least 16 characters.");
        if (password !== confirmation) throw new Error("Your passwords do not match.");
        const result = await apiJson<{ success: boolean; message: string }>("/api/auth/register", {
          method: "POST", body: JSON.stringify({ displayName, email, password, confirmation })
        });
        setNotice(result.message || "Check your inbox for the verification link.");
        setPassword(""); setConfirmation("");
      } else {
        const response = await fetch("/api/auth/login", {
          method: "POST", cache: "no-store", credentials: "same-origin",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password })
        });
        const body = await response.json();
        if (!response.ok) {
          if (body.error === "EMAIL_NOT_VERIFIED") {
            setVerifyNeeded(true);
            throw new Error(body.message || "Verify your email before signing in.");
          }
          throw new Error(body.error || "Unable to sign in.");
        }
        props.onAuthenticated(body.user as UserSession);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally { setBusy(false); }
  };

  const resend = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await apiJson<{ success: boolean; message: string }>("/api/auth/resend-verification", {
        method: "POST", body: JSON.stringify({ email, password })
      });
      setNotice(result.message || "If the account is eligible, a verification message will be sent.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to resend verification."); }
    finally { setBusy(false); }
  };

  return (
    <div className="auth-layout">
      <div className="auth-aside">
        <div className="brand-lockup">
          <div className="brand-mark"><BookOpen size={22} /></div>
          <span>mnemosyne</span>
        </div>
        <div className="auth-manifesto">
          <div className="eyebrow">A quieter place for knowledge</div>
          <h1>Keep what matters.<br /><em>Find it when it matters.</em></h1>
          <p>A private archive for your notes, research, and the ideas that connect them.</p>
          <div className="auth-assurance"><ShieldCheck size={16} /><span>Your archive is encrypted at rest and isolated to your account.</span></div>
        </div>
        <div className="auth-aside-footer">MNEMOSYNE · PERSONAL KNOWLEDGE ARCHIVE</div>
      </div>
      <div className="auth-main">
        <div className="auth-card">
          <div className="auth-mobile-brand"><div className="brand-mark"><BookOpen size={19} /></div><span>mnemosyne</span></div>
          <div className="eyebrow">{props.mode === "login" ? "Welcome back" : "Start your archive"}</div>
          <h2>{props.mode === "login" ? "Sign in to your archive" : "Create your account"}</h2>
          <p className="auth-intro">{props.mode === "login"
            ? "Your ideas are right where you left them."
            : "One account. One private space for everything worth keeping."}</p>
          <form onSubmit={submit} className="form-stack">
            {props.mode === "register" && (
              <label className="field">
                <span>Your name</span>
                <input autoComplete="name" value={displayName} onChange={e => setDisplayName(e.target.value)} required maxLength={80} placeholder="How should we address you?" />
              </label>
            )}
            <label className="field">
              <span>Email address</span>
              <input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} placeholder="you@example.com" />
            </label>
            <label className="field">
              <span>Password</span>
              <input type="password" autoComplete={props.mode === "login" ? "current-password" : "new-password"} value={password} onChange={e => setPassword(e.target.value)} required maxLength={256} placeholder="Enter your password" />
              {props.mode === "register" && <small>Use at least 16 characters. A longer passphrase is easier to remember.</small>}
            </label>
            {props.mode === "register" && (
              <label className="field">
                <span>Confirm password</span>
                <input type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} required maxLength={256} placeholder="Enter it one more time" />
              </label>
            )}
            {error && <div className="inline-alert error"><AlertCircle size={16} />{error}</div>}
            {notice && <div className="inline-alert success"><CheckCircle2 size={16} />{notice}</div>}
            <button className="button-primary auth-submit" disabled={busy} type="submit">
              {busy ? <Loader2 className="spin" size={17} /> : <Lock size={16} />}
              {props.mode === "login" ? "Sign in securely" : "Create private archive"}
              <ArrowRight size={16} />
            </button>
            {verifyNeeded && <button className="text-button" disabled={busy} type="button" onClick={resend}>Resend verification email</button>}
          </form>
          <div className="auth-switch">
            {props.mode === "login" ? <>New to Mnemosyne? <a href="/register">Create an account</a></> : <>Already have an account? <a href="/login">Sign in</a></>}
          </div>
          <div className="auth-footnote"><Lock size={13} /> Your session is protected by a secure, same-site cookie.</div>
        </div>
      </div>
    </div>
  );
}

function VerificationPage() {
  const [status, setStatus] = useState<"checking" | "success" | "error">("checking");
  const [message, setMessage] = useState("Checking your verification link…");

  useEffect(() => {
    const token = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (!token) { setStatus("error"); setMessage("This link does not contain a verification token. Sign in to request a new one."); return; }
    apiJson<{ success: boolean }>("/api/auth/verify-email", {
      method: "POST", body: JSON.stringify({ token })
    }).then(() => {
      setStatus("success"); setMessage("Your email address is confirmed. You can now sign in and open your archive.");
    }).catch(cause => {
      setStatus("error"); setMessage(cause instanceof Error ? cause.message : "This verification link is invalid or expired.");
    });
  }, []);

  return (
    <div className="auth-layout verification-layout">
      <div className="auth-aside">
        <div className="brand-lockup"><div className="brand-mark"><BookOpen size={22} /></div><span>mnemosyne</span></div>
        <div className="auth-manifesto"><div className="eyebrow">One last step</div><h1>Your archive<br /><em>is almost ready.</em></h1><p>Confirm your email address to keep your account secure.</p></div>
        <div className="auth-aside-footer">MNEMOSYNE · PERSONAL KNOWLEDGE ARCHIVE</div>
      </div>
      <div className="auth-main"><div className="auth-card verify-card">
        <div className={"verification-icon " + status}>{status === "checking" ? <Loader2 className="spin" /> : status === "success" ? <CheckCircle2 /> : <AlertCircle />}</div>
        <div className="eyebrow">Email confirmation</div>
        <h2>{status === "success" ? "You're verified" : status === "error" ? "We couldn't verify this link" : "Confirming your email"}</h2>
        <p className="auth-intro">{message}</p>
        <a className="button-primary auth-submit" href="/login">Continue to sign in <ArrowRight size={16} /></a>
      </div></div>
    </div>
  );
}

function TopicForm(props: { topicId: string | null; topics: Topic[]; onSaved: (topic: Topic) => void; onCancel: () => void; notify: (value: string) => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(Boolean(props.topicId));
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    setLoadError("");
    setTitle("");
    setSubject("");
    setDescription("");
    setCategory("");
    setCategories([]);

    const categoriesRequest = apiJson<{ categories: string[] }>("/api/topics/categories")
      .catch(() => ({ categories: [] as string[] }));
    const topicRequest = props.topicId
      ? apiJson<{ topic: Topic }>("/api/topics/" + props.topicId)
      : Promise.resolve(null);

    Promise.all([categoriesRequest, topicRequest]).then(([list, result]) => {
      if (!live) return;
      setCategories(list.categories || []);
      if (result?.topic) {
        setTitle(result.topic.title);
        setSubject(result.topic.subject || "");
        setDescription(result.topic.description || "");
        setCategory(result.topic.category || "");
      }
    }).catch(cause => {
      if (live) setLoadError(cause instanceof Error ? cause.message : "Unable to load topic details.");
    }).finally(() => {
      if (live) setLoading(false);
    });
    return () => { live = false; };
  }, [props.topicId, loadAttempt]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    if (!title.trim()) { setError("Give this collection a name."); return; }
    setSaving(true);
    try {
      const body = JSON.stringify({ title, subject, description, category });
      let saved: Topic;
      if (props.topicId) {
        await apiJson<{ success: boolean }>("/api/topics/" + props.topicId, { method: "PATCH", body });
        saved = { ...(props.topics.find(t => t.id === props.topicId) || {} as Topic), id: props.topicId, title, subject, description, category } as Topic;
        props.notify("Collection details saved.");
      } else {
        const result = await apiJson<{ topic: Topic }>("/api/topics", { method: "POST", body });
        saved = result.topic;
        props.notify("Your new collection is ready.");
      }
      props.onSaved(saved);
      router.push("/topics/" + saved.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save this collection.");
    } finally { setSaving(false); }
  };

  if (loading) return <div className="loading-panel"><Loader2 className="spin" />Loading collection…</div>;
  if (loadError) return (
    <div className="page-stack">
      <div className="inline-alert error" role="alert"><AlertCircle size={16} />{loadError}</div>
      <div className="form-footer">
        <button className="button-secondary" type="button" onClick={props.onCancel}>Back</button>
        <button className="button-primary" type="button" onClick={() => setLoadAttempt(value => value + 1)}><RefreshCw size={15} /> Retry loading</button>
      </div>
    </div>
  );

  return (
    <div className="form-page">
      <PageHeading eyebrow={props.topicId ? "Collection settings" : "New collection"} title={props.topicId ? "Shape this collection" : "Give your ideas a home"}
        description="Keep the purpose clear. You can refine the details as the collection grows." />
      <form className="surface-panel topic-form" onSubmit={submit}>
        <label className="field"><span>Collection name <b>Required</b></span>
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} autoFocus required placeholder="e.g. Cognitive Science & Memory" />
          <small>Choose a name you will recognize in your archive navigation.</small>
        </label>
        <label className="field"><span>Subject</span>
          <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={120} placeholder="A short phrase that describes its focus" />
        </label>
        <label className="field"><span>Description</span>
          <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} rows={4} placeholder="What belongs here? Capture the purpose, questions, or boundaries of this collection." />
        </label>
        <label className="field"><span>Category</span>
          <input list="topic-category-options" value={category} onChange={e => setCategory(e.target.value)} maxLength={60} placeholder="Choose or enter a category" />
          <datalist id="topic-category-options">{categories.map(item => <option key={item} value={item} />)}</datalist>
        </label>
        {error && <div className="inline-alert error"><AlertCircle size={16} />{error}</div>}
        <div className="form-footer">
          <button className="button-secondary" type="button" onClick={props.onCancel}>Cancel</button>
          <button className="button-primary" disabled={saving || !title.trim()} type="submit">
            {saving ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
            {props.topicId ? "Save collection" : "Create collection"}
          </button>
        </div>
      </form>
    </div>
  );
}

function TopicCard(props: { topic: Topic; onOpen: (id: string) => void }) {
  const topic = props.topic;
  return (
    <button className="topic-card" type="button" onClick={() => props.onOpen(topic.id)}>
      <div className="topic-card-top">
        <div className="topic-symbol"><Folder size={20} /></div>
        <span className="count-pill">{topic.noteCount} {topic.noteCount === 1 ? "note" : "notes"}</span>
      </div>
      <div className="topic-card-copy">
        <div className="eyebrow">{topic.category || "Uncategorized"}</div>
        <h3>{topic.title}</h3>
        <p>{topic.subject || topic.description || "A collection for ideas worth keeping."}</p>
      </div>
      <div className="topic-card-footer">
        <span>Updated {relativeDate(topic.updatedAt)}</span><ArrowUpRight size={16} />
      </div>
    </button>
  );
}

function TopicsPage(props: { topics: Topic[]; onOpen: (id: string) => void; onCreate: () => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedCategory = searchParams.get("category") || "";
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const categories = useMemo(() => Array.from(new Set(props.topics.map(t => t.category).filter(Boolean))).sort(), [props.topics]);
  useEffect(() => {
    setCategory(requestedCategory && categories.includes(requestedCategory) ? requestedCategory : "all");
  }, [requestedCategory, categories]);
  const filtered = useMemo(() => props.topics.filter(t =>
    (category === "all" || t.category === category) &&
    [t.title, t.subject, t.description, t.category].join(" ").toLowerCase().includes(query.toLowerCase())
  ), [props.topics, category, query]);

  return (
    <div className="page-stack">
      <PageHeading eyebrow="Your knowledge map" title="Topic collections" description="A thoughtful structure for the subjects, projects, and questions you return to."
        action={<button type="button" className="button-primary" onClick={props.onCreate}><Plus size={16} /> New collection</button>} />
      <div className="toolbar-row">
        <label className="search-field"><Search size={17} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a collection…" /></label>
        <label className="select-field"><Filter size={15} /><select value={category} onChange={e => { const value = e.target.value; setCategory(value); router.replace(value === "all" ? "/topics" : "/topics?category=" + encodeURIComponent(value), { scroll: false }); }}>
          <option value="all">All categories</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select><ChevronDown size={14} /></label>
        <span className="result-count">{filtered.length} collections</span>
      </div>
      {filtered.length ? <div className="topic-grid">{filtered.map(topic => <TopicCard key={topic.id} topic={topic} onOpen={props.onOpen} />)}</div>
        : <EmptyState icon={<Folder size={24} />} title={query || category !== "all" ? "No matching collections" : "Your first collection starts here"}
          description={query || category !== "all" ? "Try another search or choose a different category." : "Create a collection to give your research and notes a clear home."}
          action={!query && category === "all" ? <button type="button" className="button-primary" onClick={props.onCreate}><Plus size={16} /> Create a collection</button> : undefined} />}
    </div>
  );
}

function MoveCopyDialog(props: { note: Note; topics: Topic[]; onClose: () => void; onComplete: (action: "move" | "copy", topicId: string) => void; notify: (message: string) => void }) {
  const [action, setAction] = useState<"move" | "copy">("move");
  const [topicId, setTopicId] = useState(props.topics.find(t => t.id !== props.note.topicId)?.id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const destinations = props.topics.filter(t => t.id !== props.note.topicId);
  const dialogRef = useRef<HTMLElement>(null);
  const busyRef = useRef(busy);
  const onCloseRef = useRef(props.onClose);
  busyRef.current = busy;
  onCloseRef.current = props.onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!busyRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previous?.focus();
    };
  }, []);
  const submit = async () => {
    if (!topicId) { setError("Choose a destination collection."); return; }
    setBusy(true); setError("");
    try {
      await apiJson("/api/notes/" + props.note.id + "/transfer", {
        method: "POST", body: JSON.stringify({ action, topicId })
      });
      props.notify(action === "move" ? "Note moved to its new collection." : "An independent copy has been created.");
      props.onComplete(action, topicId); props.onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to transfer this note."); }
    finally { setBusy(false); }
  };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !busy) props.onClose(); }}>
      <section ref={dialogRef} tabIndex={-1} className="modal-card" role="dialog" aria-modal="true" aria-labelledby="transfer-title" aria-describedby="transfer-description">
        <div className="modal-header"><div><div className="eyebrow">Organize note</div><h2 id="transfer-title">Move or make a copy</h2></div><ActionButton title="Close dialog" onClick={props.onClose} disabled={busy}><X size={18} /></ActionButton></div>
        <p className="modal-note" id="transfer-description">“{props.note.title || "Untitled note"}”</p>
        <div className="choice-row">
          <button type="button" disabled={busy} className={action === "move" ? "choice-card selected" : "choice-card"} onClick={() => setAction("move")}><ArrowRight size={18} /><b>Move</b><small>Keep one note and change its collection.</small></button>
          <button type="button" disabled={busy} className={action === "copy" ? "choice-card selected" : "choice-card"} onClick={() => setAction("copy")}><Copy size={18} /><b>Copy</b><small>Create an independent duplicate with its images.</small></button>
        </div>
        <label className="field"><span>Destination collection</span><select value={topicId} disabled={busy} onChange={e => setTopicId(e.target.value)}>
          <option value="">Choose a collection</option>{destinations.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select></label>
        {destinations.length === 0 && <div className="inline-alert">Create another collection before moving or copying this note.</div>}
        {error && <div className="inline-alert error"><AlertCircle size={16} />{error}</div>}
        <div className="form-footer"><button className="button-secondary" onClick={props.onClose} disabled={busy} type="button">Cancel</button><button className="button-primary" disabled={busy || !topicId} onClick={submit} type="button">{busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />}{action === "move" ? "Move note" : "Create copy"}</button></div>
      </section>
    </div>
  );
}

function NoteRow(props: { note: Note; topics: Topic[]; onRefresh: () => void; onTopicsChanged?: () => void; notify: (message: string) => void }) {
  const router = useRouter();
  const [transferOpen, setTransferOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const preview = plainText(props.note.content).slice(0, 190);
  const togglePin = async () => {
    setBusy(true);
    try {
      await apiJson("/api/notes/" + props.note.id + "/pin", {
        method: "PATCH", body: JSON.stringify({ pinned: !props.note.pinned })
      });
      props.notify(props.note.pinned ? "Removed from pinned notes." : "Pinned for quick access.");
      props.onRefresh();
      props.onTopicsChanged?.();
    } catch (cause) { props.notify(cause instanceof Error ? cause.message : "Unable to update pin."); }
    finally { setBusy(false); }
  };
  const moveToTrash = async () => {
    if (!window.confirm("Move this note to Trash? You can restore it later.")) return;
    setBusy(true);
    try {
      await apiJson("/api/notes/" + props.note.id, { method: "DELETE" });
      props.notify("Note moved to Trash.");
      props.onRefresh();
      props.onTopicsChanged?.();
    } catch (cause) { props.notify(cause instanceof Error ? cause.message : "Unable to move note to Trash."); }
    finally { setBusy(false); }
  };
  const share = async () => {
    const url = window.location.origin + "/notes/" + props.note.id + "/read";
    try {
      await navigator.clipboard.writeText(url);
      props.notify("Reading link copied. Recipients need access to this archive.");
    } catch { props.notify("Your browser could not copy the reading link."); }
  };
  return (
    <article className="note-row">
      <button type="button" className="note-row-main" onClick={() => router.push("/notes/" + props.note.id + "/read")}>
        <div className="note-row-icon"><FileText size={18} /></div>
        <div className="note-row-copy">
          <div className="note-row-title-line"><h3>{props.note.title || "Untitled note"}</h3>{props.note.pinned && <Pin size={14} className="pin-mark" />}</div>
          {props.note.subject && <p className="note-subject">{props.note.subject}</p>}
          <p className="note-preview">{preview || "An empty note. Open it to add your first thought."}</p>
          <div className="note-meta"><span className="topic-chip">{props.note.topicTitle || props.topics.find(t => t.id === props.note.topicId)?.title || "Collection"}</span><span>{relativeDate(props.note.updatedAt)}</span><span>{plainText(props.note.content).trim() ? plainText(props.note.content).trim().split(/\s+/).length + " words" : "No words yet"}</span>{(props.note.tags || []).slice(0, 3).map(tag => <span className="tag-chip" key={tag}>#{tag}</span>)}</div>
        </div>
      </button>
      <div className="note-row-actions">
        <ActionButton title="Read note" onClick={() => router.push("/notes/" + props.note.id + "/read")}><Eye size={16} /></ActionButton>
        <ActionButton title="Edit note" onClick={() => router.push("/notes/" + props.note.id)}><Edit3 size={16} /></ActionButton>
        <ActionButton title={props.note.pinned ? "Unpin note" : "Pin note"} onClick={togglePin} disabled={busy}><Pin size={16} /></ActionButton>
        <details className="more-menu"><summary aria-label="More note actions" title="More actions"><MoreHorizontal size={18} /></summary>
          <div className="menu-popover">
            <button type="button" onClick={() => setTransferOpen(true)}><ArrowDownUp size={15} /> Move or copy</button>
            <button type="button" onClick={share}><Share2 size={15} /> Share reading link</button>
            <button type="button" onClick={() => saveMarkdown(props.note.title, props.note.content)}><Download size={15} /> Export Markdown</button>
            <button type="button" className="danger-menu-item" onClick={moveToTrash}><Trash2 size={15} /> Move to Trash</button>
          </div>
        </details>
      </div>
      {transferOpen && <MoveCopyDialog note={props.note} topics={props.topics} onClose={() => setTransferOpen(false)} onComplete={() => { props.onRefresh(); props.onTopicsChanged?.(); }} notify={props.notify} />}
    </article>
  );
}

function NotesPage(props: { topics: Topic[]; pinnedOnly: boolean; notify: (message: string) => void; onTopicsChanged: () => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [error, setError] = useState("");

  const load = useCallback(async (offset: number, append: boolean) => {
    if (append) setLoadingMore(true); else setLoading(true);
    setError("");
    try {
      const limit = props.pinnedOnly ? 100 : 50;
      const result = await apiJson<{ notes: Note[]; pagination?: Pagination }>("/api/notes?limit=" + limit + "&offset=" + offset);
      setNotes(current => append ? current.concat(result.notes) : result.notes);
      setPagination(result.pagination || null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load notes."); }
    finally { setLoading(false); setLoadingMore(false); }
  }, [props.pinnedOnly]);

  useEffect(() => { void load(0, false); }, [load]);
  const visible = useMemo(() => {
    let values = props.pinnedOnly ? notes.filter(n => n.pinned) : notes;
    values = values.filter(n => [n.title, n.subject, n.topicTitle, (n.tags || []).join(" "), plainText(n.content)].join(" ").toLowerCase().includes(query.toLowerCase()));
    return values.sort((a, b) => sort === "oldest" ? new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
      : sort === "title" ? a.title.localeCompare(b.title) : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [notes, props.pinnedOnly, query, sort]);

  const title = props.pinnedOnly ? "Pinned notes" : "All notes";
  return (
    <div className="page-stack">
      <PageHeading eyebrow="Your manuscripts" title={title} description={props.pinnedOnly ? "The fragments you chose to keep within easy reach." : "Every note in your archive, in one searchable place."}
        action={<a className="button-primary" href="/notes/new"><Plus size={16} /> New note</a>} />
      <div className="toolbar-row">
        <label className="search-field"><Search size={17} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search titles, text, topics, tags…" /></label>
        <label className="select-field"><ArrowDownUp size={15} /><select value={sort} onChange={e => setSort(e.target.value)}><option value="recent">Recently updated</option><option value="oldest">Oldest updated</option><option value="title">Title A–Z</option></select><ChevronDown size={14} /></label>
        <span className="result-count">{visible.length}{pagination ? " shown" : ""}</span>
      </div>
      {error && <div className="inline-alert error"><AlertCircle size={16} />{error}<button type="button" onClick={() => load(0, false)}>Retry</button></div>}
      {loading ? <div className="loading-panel"><Loader2 className="spin" />Loading your notes…</div>
        : visible.length ? <div className="note-list">{visible.map(note => <NoteRow key={note.id} note={note} topics={props.topics} onRefresh={() => load(0, false)} onTopicsChanged={props.onTopicsChanged} notify={props.notify} />)}</div>
          : !error ? <EmptyState icon={props.pinnedOnly ? <Pin size={24} /> : <FileText size={24} />}
            title={query ? "No notes match that search" : props.pinnedOnly ? "Nothing pinned yet" : "A page waiting for a first thought"}
            description={query ? "Try another word or clear your search." : props.pinnedOnly ? "Pin useful notes and they will collect here." : "Create a note to capture an idea, question, or useful reference."}
            action={!query ? <a className="button-primary" href="/notes/new"><Plus size={16} /> Create a note</a> : undefined} /> : null}
      {!loading && pagination?.hasMore && <div className="load-more"><button type="button" className="button-secondary" disabled={loadingMore} onClick={() => load(pagination.offset + pagination.limit, true)}>{loadingMore ? <Loader2 className="spin" size={16} /> : <ChevronDown size={16} />} Load more notes</button></div>}
    </div>
  );
}

function TopicPage(props: { topicId: string; topics: Topic[]; onRefreshTopics: () => void; notify: (message: string) => void }) {
  const router = useRouter();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const coverInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = await apiJson<{ topic: Topic; notes: Note[] }>("/api/topics/" + props.topicId);
      setTopic(result.topic); setNotes(result.notes);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load this collection."); }
    finally { setLoading(false); }
  }, [props.topicId]);
  useEffect(() => { void load(); }, [load]);

  const uploadCover = async (file?: File) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      props.notify("Topic covers must be 8 MB or smaller.");
      if (coverInput.current) coverInput.current.value = "";
      return;
    }
    setUploading(true);
    const form = new FormData(); form.set("file", file);
    try {
      const result = await apiJson<{ coverUrl: string }>("/api/topics/" + props.topicId + "/cover", { method: "POST", body: form });
      setTopic(current => current ? { ...current, coverUrl: result.coverUrl } : current);
      props.notify("Collection cover updated.");
      props.onRefreshTopics();
    } catch (cause) { props.notify(cause instanceof Error ? cause.message : "Unable to upload this cover."); }
    finally { setUploading(false); if (coverInput.current) coverInput.current.value = ""; }
  };

  const removeCover = async () => {
    if (uploading || deleting || !window.confirm("Remove this collection cover?")) return;
    setUploading(true);
    try {
      await apiJson("/api/topics/" + props.topicId + "/cover", { method: "DELETE" });
      setTopic(current => current ? { ...current, coverUrl: null } : current);
      props.notify("Collection cover removed.");
      props.onRefreshTopics();
    } catch (cause) { props.notify(cause instanceof Error ? cause.message : "Unable to remove cover."); }
    finally { setUploading(false); }
  };

  const exportImages = async () => {
    try {
      const response = await fetch("/api/topics/" + props.topicId + "/images", { cache: "no-store" });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error || "Unable to export collection images."); }
      downloadBlob(await response.blob(), (topic?.title || "topic").replace(/[\\/:*?"<>|]+/g, "-") + "-images.zip");
    } catch (cause) { props.notify(cause instanceof Error ? cause.message : "Unable to export images."); }
  };

  const deleteTopic = async () => {
    if (uploading || deleting) return;
    if (notes.length) { props.notify("Move or delete the active notes before deleting this collection."); return; }
    if (topic?.trashedNoteCount) { props.notify("Restore or permanently delete the notes in Trash before deleting this collection."); return; }
    if (!window.confirm("Delete this empty collection? This cannot be undone.")) return;
    setDeleting(true);
    try {
      await apiJson("/api/topics/" + props.topicId, { method: "DELETE" });
      props.notify("Empty collection deleted."); props.onRefreshTopics(); router.push("/topics");
    } catch (cause) { props.notify(cause instanceof Error ? cause.message : "Unable to delete collection."); }
    finally { setDeleting(false); }
  };

  if (loading) return <div className="loading-panel"><Loader2 className="spin" />Opening collection…</div>;
  if (error || !topic) return <div className="page-stack"><div className="inline-alert error" role="alert"><AlertCircle size={16} />{error || "Collection not found."}</div><div className="form-footer"><button type="button" className="button-secondary" onClick={() => router.push("/topics")}><ArrowLeft size={16} /> Back to collections</button><button type="button" className="button-primary" onClick={() => void load()}><RefreshCw size={15} /> Retry loading</button></div></div>;

  return (
    <div className="page-stack">
      <button type="button" className="back-link" onClick={() => router.push("/topics")}><ArrowLeft size={15} /> All collections</button>
      <section className="topic-hero">
        {topic.coverUrl ? <img className="topic-cover" src={topic.coverUrl} alt="" /> : <div className="topic-cover-placeholder"><Folder size={34} /><span>YOUR COLLECTION</span></div>}
        <div className="topic-hero-overlay" />
        <div className="topic-hero-content">
          <div className="eyebrow">{topic.category || "Collection"} · {notes.length} {notes.length === 1 ? "note" : "notes"}</div>
          <h1>{topic.title}</h1>
          {topic.subject && <p className="topic-subject-large">{topic.subject}</p>}
          {topic.description && <p className="topic-description">{topic.description}</p>}
          <div className="topic-hero-actions">
            <a className="button-primary" href={"/notes/new?topicId=" + topic.id}><Plus size={16} /> Add note</a>
            <button type="button" className="button-glass" onClick={() => router.push("/topics/" + topic.id + "/edit")}><Edit3 size={15} /> Edit collection</button>
            <button type="button" className="button-glass" onClick={() => coverInput.current?.click()} disabled={uploading || deleting}>{uploading ? <Loader2 className="spin" size={15} /> : <Upload size={15} />} {topic.coverUrl ? "Change cover" : "Add cover"}</button>
            {topic.coverUrl && <button type="button" className="button-glass" onClick={removeCover} disabled={uploading || deleting}>Remove cover</button>}
            <button type="button" className="button-glass" onClick={exportImages}><FileArchive size={15} /> Export images</button>
            {notes.length === 0 && !topic.trashedNoteCount && <button type="button" className="button-glass danger-glass" disabled={uploading || deleting} onClick={deleteTopic}><Trash2 size={15} /> {deleting ? "Deleting…" : "Delete empty collection"}</button>}
            <input ref={coverInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => void uploadCover(e.target.files?.[0])} />
          </div>
        </div>
      </section>
      {Boolean(topic.trashedNoteCount) && <div className="inline-alert" role="status"><Trash2 size={16} /> This collection has {topic.trashedNoteCount} note{topic.trashedNoteCount === 1 ? "" : "s"} in Trash. Restore or permanently delete {topic.trashedNoteCount === 1 ? "it" : "them"} before deleting the collection. <a href="/trash">Open Trash</a></div>}
      <div className="section-heading"><div><div className="eyebrow">In this collection</div><h2>Notes and fragments</h2></div><span className="result-count">{notes.length} items</span></div>
      {notes.length ? <div className="note-list">{notes.map(note => <NoteRow key={note.id} note={{ ...note, topicTitle: topic.title }} topics={props.topics} onRefresh={load} onTopicsChanged={props.onRefreshTopics} notify={props.notify} />)}</div>
        : <EmptyState icon={<FileText size={24} />} title="This collection is ready for its first note" description="Start with an observation, a question, a source, or a small idea. You can connect it to other work later." action={<a className="button-primary" href={"/notes/new?topicId=" + topic.id}><Plus size={16} /> Write the first note</a>} />}
    </div>
  );
}

function SearchPage(props: { notify: (message: string) => void; topics: Topic[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedQuery = searchParams.get("q") || "";
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [notes, setNotes] = useState<SearchResult[]>([]);
  const [topics, setTopics] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [submittedScope, setSubmittedScope] = useState("all");

  useEffect(() => {
    setQuery(requestedQuery);
  }, [requestedQuery]);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) { setNotes([]); setTopics([]); setSubmittedQuery(""); setError(""); setLoading(false); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const response = await fetch("/api/search?q=" + encodeURIComponent(normalized) + "&scope=" + scope, { cache: "no-store", signal: controller.signal });
        if (response.status === 204) { setNotes([]); setTopics([]); setSubmittedQuery(normalized); setSubmittedScope(scope); return; }
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Search failed.");
        setNotes(body.notes || []); setTopics(body.topics || []); setSubmittedQuery(normalized); setSubmittedScope(scope);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Search failed.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 260);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, scope, retryAttempt]);

  const total = notes.length + topics.length;
  const hasCurrentResults = submittedQuery === query.trim() && submittedScope === scope && !loading && !error;
  return (
    <div className="page-stack">
      <PageHeading eyebrow="Find a connection" title="Deep search" description="Search note titles, subjects, tags, topic names, and the text inside your notes." />
      <section className="search-stage">
        <div className="search-stage-input"><Search size={22} /><input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="What are you trying to remember?" aria-label="Search your archive" /><kbd>LIVE SEARCH</kbd></div>
        <div className="search-scopes" role="group" aria-label="Search scope">
          {[["all", "Everything"], ["titles", "Titles"], ["tags", "Tags"], ["pinned", "Pinned"]].map(([value, label]) =>
            <button type="button" key={value} className={scope === value ? "scope-pill active" : "scope-pill"} onClick={() => setScope(value)}>{label}</button>)}
        </div>
      </section>
      {error && <div className="inline-alert error" role="alert"><AlertCircle size={16} />{error}<button type="button" onClick={() => setRetryAttempt(value => value + 1)}><RefreshCw size={14} /> Retry search</button></div>}
      {loading && <div className="search-progress"><Loader2 className="spin" size={16} /> Looking through your archive…</div>}
      {hasCurrentResults && submittedQuery && <div className="search-summary"><span><b>{total}</b> matching results for <strong>“{submittedQuery}”</strong></span><span>Search is performed within your authenticated archive.</span></div>}
      {!query.trim() ? <div className="search-hint"><Sparkles size={18} /><p>Try a phrase, a person, a concept, or a tag you remember.</p></div>
        : hasCurrentResults && total === 0 && <EmptyState icon={<Search size={24} />} title="No matching fragments" description="Try a broader phrase, or change the search scope." />}
      {hasCurrentResults && topics.length > 0 && <section className="search-results-section"><div className="section-heading"><h2>Collections</h2><span>{topics.length}</span></div><div className="search-topic-results">{topics.map(topic => <button type="button" key={topic.id} onClick={() => router.push("/topics/" + topic.id)} className="search-topic-result"><Folder size={18} /><span><b>{topic.title}</b><small>{topic.category || "Collection"}{topic.subject ? " · " + topic.subject : ""}</small></span><ArrowUpRight size={16} /></button>)}</div></section>}
      {hasCurrentResults && notes.length > 0 && <section className="search-results-section"><div className="section-heading"><h2>Notes</h2><span>{notes.length}</span></div><div className="note-list">{notes.map(note => <button type="button" key={note.id} className="search-note-result" onClick={() => router.push("/notes/" + note.id + "/read")}><div className="note-row-icon"><FileText size={18} /></div><div className="note-row-copy"><div className="note-row-title-line"><h3>{note.title}</h3>{note.pinned && <Pin size={14} className="pin-mark" />}</div><p className="note-preview">{note.preview || note.subject || "Open note to see its contents."}</p><div className="note-meta"><span className="topic-chip">{note.topicTitle || "Collection"}</span><span className="match-chip">{note.matchType || "content"} match</span>{(note.tags || []).slice(0, 3).map(tag => <span className="tag-chip" key={tag}>#{tag}</span>)}</div></div><ArrowUpRight size={17} /></button>)}</div></section>}
      {hasCurrentResults && total > 0 && <div className="search-footnote">Search returns up to 25 collections and 40 notes per query.</div>}
    </div>
  );
}

function TrashPage(props: { notify: (message: string) => void; onTopicsChanged: () => void }) {
  const [notes, setNotes] = useState<any[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async (offset = 0, append = false) => {
    if (append) setLoadingMore(true); else setLoading(true);
    setError("");
    try {
      const result = await apiJson<{ notes: any[]; pagination: Pagination }>("/api/trash?limit=50&offset=" + offset);
      setNotes(current => append ? current.concat(result.notes) : result.notes);
      setPagination(result.pagination);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load Trash."); }
    finally { setLoading(false); setLoadingMore(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (note: any, action: "restore" | "delete") => {
    if (action === "delete" && !window.confirm("Permanently delete this note and its attached images? This cannot be undone.")) return;
    setBusyId(note.id);
    try {
      await apiJson("/api/trash", { method: "POST", body: JSON.stringify({ id: note.id, action }) });
      props.notify(action === "restore" ? "Note restored to its collection." : "Note permanently deleted.");
      if (action === "restore") props.onTopicsChanged();
      await load();
    } catch (cause) { props.notify(cause instanceof Error ? cause.message : "Unable to update Trash."); }
    finally { setBusyId(""); }
  };

  return (
    <div className="page-stack">
      <PageHeading eyebrow="Recover or remove" title="Trash" description="Notes stay here until you restore them or permanently delete them. Their attached images are kept with them." />
      {error && <div className="inline-alert error"><AlertCircle size={16} />{error}<button type="button" onClick={() => load()}>Retry</button></div>}
      {loading ? <div className="loading-panel"><Loader2 className="spin" />Loading Trash…</div>
        : notes.length ? <div className="note-list">{notes.map(note => <article key={note.id} className="trash-row"><div className="note-row-icon"><Trash2 size={18} /></div><div className="note-row-copy"><h3>{note.title || "Untitled note"}</h3><p className="note-subject">{note.subject || "No description"}</p><div className="note-meta"><span className="topic-chip">{note.topicTitle}</span><span>Deleted {formatDate(note.deletedAt, true)}</span></div></div><div className="trash-actions"><button type="button" className="button-secondary small" disabled={busyId === note.id} onClick={() => act(note, "restore")}><RotateCcw size={15} /> Restore</button><button type="button" className="button-danger small" disabled={busyId === note.id} onClick={() => act(note, "delete")}><Trash2 size={15} /> Delete permanently</button></div></article>)}</div>
          : !error ? <EmptyState icon={<Trash2 size={24} />} title="Trash is empty" description="When you remove a note, it will appear here so you can recover it." /> : null}
      {!loading && pagination?.hasMore && <div className="load-more"><button type="button" className="button-secondary" disabled={loadingMore} onClick={() => load(pagination.offset + pagination.limit, true)}>{loadingMore ? <Loader2 className="spin" size={16} /> : <ChevronDown size={15} />} Load more deleted notes</button></div>}
    </div>
  );
}

function SettingsPage(props: { session: UserSession; onLogout: () => void; notify: (message: string) => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const changePassword = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setSuccess("");
    if (newPassword.length < 16) { setError("Use a new password of at least 16 characters."); return; }
    if (newPassword !== confirmPassword) { setError("The new passwords do not match."); return; }
    setBusy(true);
    try {
      await apiJson("/api/settings/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setSuccess("Your account password has been updated. Other active sessions have been signed out.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update password."); }
    finally { setBusy(false); }
  };

  return (
    <div className="page-stack">
      <PageHeading eyebrow="Account and protection" title="Settings" description="Manage the sign-in credentials and the session protecting your private archive." />
      <section className="settings-card">
        <div className="settings-card-heading"><div className="settings-icon"><KeyRound size={19} /></div><div><h2>Change account password</h2><p>Your password protects the wrapped vault key and account access.</p></div></div>
        <form className="form-stack narrow-form" onSubmit={changePassword}>
          <label className="field"><span>Current password</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required maxLength={256} /></label>
          <label className="field"><span>New password</span><input type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required maxLength={256} /><small>At least 16 characters. Consider using a unique passphrase.</small></label>
          <label className="field"><span>Confirm new password</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required maxLength={256} /></label>
          {error && <div className="inline-alert error"><AlertCircle size={16} />{error}</div>}
          {success && <div className="inline-alert success"><CheckCircle2 size={16} />{success}</div>}
          <div><button className="button-primary" disabled={busy} type="submit">{busy ? <Loader2 size={16} className="spin" /> : <Save size={16} />} Update password</button></div>
        </form>
      </section>
      <section className="settings-card">
        <div className="settings-card-heading"><div className="settings-icon"><ShieldCheck size={19} /></div><div><h2>Archive security</h2><p>How your account is protected.</p></div></div>
        <div className="security-list">
          <div><span>Storage encryption</span><b><CheckCircle2 size={15} /> AES-256-GCM at rest</b></div>
          <div><span>Account isolation</span><b><CheckCircle2 size={15} /> Per-account vault and database row-level security</b></div>
          <div><span>Session protection</span><b><CheckCircle2 size={15} /> HttpOnly, same-site session cookie</b></div>
        </div>
        <p className="security-note">Mnemosyne encrypts archive data at rest and decrypts it on the application server for an authenticated session. This is not zero-knowledge end-to-end encryption; the server remains part of the security boundary.</p>
      </section>
      <section className="settings-card account-card">
        <div className="settings-card-heading"><div className="settings-icon"><Lock size={19} /></div><div><h2>Signed-in account</h2><p>{props.session.displayName} · {props.session.email}</p></div></div>
        <button type="button" className="button-danger" onClick={props.onLogout}><LogOut size={16} /> Lock archive and sign out</button>
      </section>
    </div>
  );
}

function DashboardPage(props: { topics: Topic[]; session: UserSession; notify: (message: string) => void; onTopicsChanged: () => void }) {
  const router = useRouter();
  const [notes, setNotes] = useState<Note[]>([]);
  const [recentNotes, setRecentNotes] = useState<Note[]>([]);
  const [totalNotes, setTotalNotes] = useState(0);
  const [pinnedCount, setPinnedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = await apiJson<{ notes: Note[]; recentNotes?: Note[]; pagination: Pagination }>("/api/notes?limit=100&offset=0&summary=dashboard");
      setNotes(result.notes);
      setRecentNotes(result.recentNotes || []);
      setTotalNotes(result.pagination?.total ?? result.notes.length);
      setPinnedCount(result.pagination?.pinnedCount ?? result.notes.filter(note => note.pinned).length);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load your archive."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const sorted = useMemo(() => [...recentNotes].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [recentNotes]);
  const latest = sorted[0];
  const pinned = notes.filter(n => n.pinned).slice(0, 3);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const name = props.session.displayName?.trim().split(/\s+/)[0] || "there";
  const pinCountLabel = String(pinnedCount);

  return (
    <div className="page-stack dashboard-page">
      <section className="welcome-section">
        <div className="welcome-copy"><div className="eyebrow green-eyebrow"><ShieldCheck size={15} /> Your private knowledge archive</div>
          <h1>{greeting}, {name}.</h1>
          <p>Your archive is ready. Capture a new thought, revisit a useful fragment, or follow a connection that has been waiting for you.</p>
        </div>
        <div className="welcome-actions">
          <a className="button-primary" href="/notes/new"><Plus size={17} /> New note <kbd>N</kbd></a>
          <a className="button-secondary" href="/topics/new"><FolderPlus size={16} /> New collection <kbd>T</kbd></a>
          <a className="button-quiet" href="/search"><Search size={16} /> Deep search <kbd>⌘K</kbd></a>
        </div>
      </section>
      <section className="archive-health-strip">
        <div><span className="health-icon"><Lock size={17} /></span><span><small>Vault protection</small><b>Encrypted at rest</b></span></div>
        <div><span className="health-icon"><ShieldCheck size={17} /></span><span><small>Account boundary</small><b>Private to your account</b></span></div>
        <div><span className="health-icon"><Clock3 size={17} /></span><span><small>Last session expiry</small><b>{props.session.expiresAt ? formatDate(props.session.expiresAt, true) : "Session active"}</b></span></div>
      </section>
      <section className="metric-grid">
        <div className="metric-card"><div className="metric-label"><span>Collections</span><Folder size={17} /></div><strong>{props.topics.length}</strong><small>Personal topic spaces</small></div>
        <div className="metric-card"><div className="metric-label"><span>Notes in archive</span><FileText size={17} /></div><strong>{totalNotes}</strong><small>Saved manuscripts and fragments</small></div>
        <div className="metric-card"><div className="metric-label"><span>Pinned notes</span><Pin size={17} /></div><strong>{pinCountLabel}</strong><small>{pinnedCount > 100 ? "Across your archive" : "Quick-access anchors"}</small></div>
        <div className="metric-card"><div className="metric-label"><span>Latest activity</span><Clock3 size={17} /></div><strong className="metric-date">{latest ? relativeDate(latest.updatedAt) : "—"}</strong><small>{latest ? "Most recently updated note" : "Your archive is ready"}</small></div>
      </section>
      {error && <div className="inline-alert error"><AlertCircle size={16} />{error}<button type="button" onClick={load}>Retry</button></div>}
      <section className="resume-section">
        <div className="section-label"><BookText size={18} /><span>Continue where you left off</span>{latest && <span className="section-meta">Updated {relativeDate(latest.updatedAt)}</span>}</div>
        {loading ? <div className="resume-card skeleton-card"><Loader2 className="spin" /> Loading your latest note…</div>
          : latest ? <div className="resume-card">
            <div className="resume-main"><div className="resume-meta"><span className="topic-chip">{latest.topicTitle || "Your archive"}</span>{latest.pinned && <span className="pin-chip"><Pin size={12} /> Pinned</span>}<span>{plainText(latest.content).trim() ? plainText(latest.content).trim().split(/\s+/).length + " words" : "New note"}</span></div>
              <h2>{latest.title || "Untitled note"}</h2><p>{latest.subject || plainText(latest.content).slice(0, 260) || "Open this note and keep shaping the idea."}</p>
              <div className="resume-tags">{(latest.tags || []).slice(0, 5).map(tag => <span key={tag}>#{tag}</span>)}</div>
            </div>
            <div className="resume-actions"><button type="button" className="button-primary" onClick={() => router.push("/notes/" + latest.id)}><Edit3 size={16} /> Resume writing</button><button type="button" className="button-secondary" onClick={() => router.push("/notes/" + latest.id + "/read")}><BookOpen size={16} /> Focus reading</button></div>
          </div>
          : <div className="resume-card"><div className="resume-main"><div className="eyebrow">A blank page is a beginning</div><h2>Your next useful idea starts here.</h2><p>Capture a question, a passage, a discovery, or the outline of something you want to understand.</p></div><a className="button-primary" href="/notes/new"><Plus size={16} /> Create your first note</a></div>}
      </section>
      <section className="dashboard-columns">
        <div className="dashboard-column">
          <div className="section-heading"><div><div className="eyebrow">Your recent thinking</div><h2>Recently updated notes</h2></div><a className="subtle-link" href="/all-notes">View all <ArrowRight size={14} /></a></div>
          {loading ? <div className="loading-panel"><Loader2 className="spin" />Loading notes…</div>
            : sorted.length ? <div className="note-list compact-list">{sorted.slice(0, 5).map(note => <NoteRow key={note.id} note={note} topics={props.topics} onRefresh={load} onTopicsChanged={props.onTopicsChanged} notify={props.notify} />)}</div>
              : !error ? <EmptyState icon={<FileText size={22} />} title="No notes yet" description="Start with one thought. You can organize it into a collection." action={<a href="/notes/new" className="button-primary"><Plus size={16} /> New note</a>} /> : null}
        </div>
        <aside className="dashboard-column pinned-column">
          <div className="section-heading"><div><div className="eyebrow">Keep close</div><h2>Pinned anchors</h2></div><a className="subtle-link" href="/pinned">See all <ArrowRight size={14} /></a></div>
          {pinned.length ? <div className="pinned-stack">{pinned.map(note => <button type="button" className="pinned-card" key={note.id} onClick={() => router.push("/notes/" + note.id + "/read")}><div><span className="pinned-label"><Pin size={12} /> Pinned note</span><ArrowUpRight size={15} /></div><h3>{note.title || "Untitled note"}</h3><p>{plainText(note.content).slice(0, 120) || note.subject || "Open this fragment to continue reading."}</p><small>{note.topicTitle || "Collection"} · {relativeDate(note.updatedAt)}</small></button>)}</div>
            : <div className="mini-empty"><Pin size={18} /><p>Pin a note to keep an important idea close at hand.</p></div>}
        </aside>
      </section>
      <section className="topic-section">
        <div className="section-heading"><div><div className="eyebrow">Your knowledge map</div><h2>Topic collections</h2></div><a className="subtle-link" href="/topics">Explore all <ArrowRight size={14} /></a></div>
        {props.topics.length ? <div className="topic-grid dashboard-topic-grid">{props.topics.slice(0, 4).map(topic => <TopicCard key={topic.id} topic={topic} onOpen={id => router.push("/topics/" + id)} />)}</div>
          : <EmptyState icon={<Folder size={22} />} title="Create your first collection" description="Collections make it easier to bring related notes, sources, and thoughts together." action={<a className="button-primary" href="/topics/new"><FolderPlus size={16} /> New collection</a>} />}
      </section>
      <footer className="archive-footer"><div><BookOpen size={17} /><span><b>Mnemosyne</b><small>Private knowledge, patiently kept.</small></span></div><span>Account-isolated archive · Encrypted at rest</span></footer>
    </div>
  );
}

function NoteEditorPage(props: { noteId: string | null; topics: Topic[]; notify: (message: string) => void; onTopicsChanged: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [topicId, setTopicId] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [pinned, setPinned] = useState(false);
  const [loading, setLoading] = useState(Boolean(props.noteId));
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "unsaved" | "saving">("saved");
  const [busyUpload, setBusyUpload] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [rtl, setRtl] = useState(false);
  const [revision, setRevision] = useState(0);
  const uploadRef = useRef<HTMLInputElement>(null);
  const hydrating = useRef(false);
  const saving = useRef(false);
  const revisionRef = useRef(0);
  const persistedTopicId = useRef("");
  const isNew = !props.noteId;

  const editor = useEditor({
    extensions: editorExtensions(),
    content: EMPTY_DOC,
    immediatelyRender: false,
    editorProps: { attributes: { class: "tiptap-content", spellcheck: "true" } },
    onUpdate: () => {
      if (hydrating.current) return;
      revisionRef.current += 1; setRevision(revisionRef.current); setDirty(true); setSaveState("unsaved");
    }
  });

  useEffect(() => {
    let live = true;
    if (props.noteId) {
      setLoading(true);
      setLoadError("");
      apiJson<{ note: Note }>("/api/notes/" + props.noteId).then(result => {
        if (!live) return;
        setTitle(result.note.title || ""); setSubject(result.note.subject || "");
        setTopicId(result.note.topicId); persistedTopicId.current = result.note.topicId; setTags(result.note.tags || []); setPinned(Boolean(result.note.pinned));
        if (editor) {
          hydrating.current = true;
          editor.commands.setContent(result.note.content || EMPTY_DOC);
          hydrating.current = false;
        }
      }).catch(cause => {
        if (live) setLoadError(cause instanceof Error ? cause.message : "Unable to open this note.");
      }).finally(() => { if (live) setLoading(false); });
    } else {
      const requestedTopic = new URLSearchParams(window.location.search).get("topicId") || "";
      setTopicId(requestedTopic); setLoading(false);
    }
    return () => { live = false; };
  }, [props.noteId, editor, loadAttempt]);

  const saveNote = useCallback(async (automatic = false) => {
    if (saving.current || loading || busyUpload) {
      if (!automatic && busyUpload) setError("Wait for the image upload to finish before saving.");
      return;
    }
    if (!topicId || !title.trim()) {
      if (!automatic) setError(!topicId ? "Choose a collection before saving this note." : "Give your note a title before saving.");
      return;
    }
    saving.current = true; setError(""); setSaveState("saving");
    const snapshotRevision = revisionRef.current;
    const payload = {
      topicId, title: title.trim(), subject, tags, pinned,
      content: editor?.getJSON() || EMPTY_DOC
    };
    try {
      if (props.noteId) {
        await apiJson("/api/notes/" + props.noteId, { method: "PATCH", body: JSON.stringify(payload) });
        if (revisionRef.current === snapshotRevision) {
          setDirty(false); setSaveState("saved");
        } else { setSaveState("unsaved"); }
        if (persistedTopicId.current !== topicId) {
          persistedTopicId.current = topicId;
          props.onTopicsChanged();
        }
        if (!automatic) props.notify("Your note is saved.");
      } else {
        // Lock the first draft while the server creates its permanent note ID.
        // Otherwise edits made during this request would be overwritten when the
        // editor remounts on the newly-created note route.
        setCreating(true);
        editor?.setEditable(false);
        const result = await apiJson<{ note: Note }>("/api/notes", { method: "POST", body: JSON.stringify(payload) });
        persistedTopicId.current = topicId;
        props.onTopicsChanged();
        props.notify("Your note has been created.");
        router.replace("/notes/" + result.note.id);
      }
    } catch (cause) {
      if (isNew) {
        setCreating(false);
        editor?.setEditable(true);
      }
      setError(cause instanceof Error ? cause.message : "Unable to save this note.");
      setSaveState("unsaved");
    } finally {
      saving.current = false;
      // If the user kept typing while a save was in flight, schedule another
      // pass rather than leaving those newer edits stranded as unsaved.
      if (revisionRef.current !== snapshotRevision && !isNew) {
        setSaveState("unsaved");
        revisionRef.current += 1;
        setRevision(revisionRef.current);
      }
    }
  }, [loading, busyUpload, topicId, title, subject, tags, pinned, editor, props.noteId, props.notify, props.onTopicsChanged, router, isNew]);

  const saveRef = useRef(saveNote);
  useEffect(() => { saveRef.current = saveNote; }, [saveNote]);
  useEffect(() => {
    if (isNew || !dirty || loading) return;
    const timer = window.setTimeout(() => { void saveRef.current(true); }, 1400);
    return () => window.clearTimeout(timer);
  }, [dirty, revision, isNew, loading, busyUpload]);

  const touchForm = () => { revisionRef.current += 1; setRevision(revisionRef.current); setDirty(true); setSaveState("unsaved"); };
  const addTag = () => {
    const value = tagInput.trim().replace(/^#/, "");
    if (!value) return;
    if (tags.length >= 30) { setError("A note can have up to 30 tags."); return; }
    if (!tags.some(t => t.toLowerCase() === value.toLowerCase())) { setTags(current => current.concat(value)); touchForm(); }
    setTagInput("");
  };
  const updateDirection = (next: boolean) => {
    setRtl(next);
    if (!editor) return;
    editor.chain().focus().command(({ state, tr, dispatch }) => {
      state.doc.descendants((node, pos) => {
        if (node.type.name === "paragraph" || node.type.name === "heading") tr.setNodeMarkup(pos, undefined, { ...node.attrs, dir: next ? "rtl" : "ltr" });
      });
      if (dispatch) dispatch(tr);
      return true;
    }).run();
  };

  const uploadImage = async (file?: File) => {
    if (!file || !props.noteId) return;
    if (file.size > 20 * 1024 * 1024) {
      setError("Images must be 20 MB or smaller.");
      if (uploadRef.current) uploadRef.current.value = "";
      return;
    }
    setBusyUpload(true);
    setError("");
    const form = new FormData();
    form.set("file", file);
    let uploadedAssetUrl: string | null = null;
    try {
      const result = await apiJson<{ asset: { url: string } }>("/api/notes/" + props.noteId + "/assets", { method: "POST", body: form });
      uploadedAssetUrl = result.asset.url;
      if (!editor || editor.isDestroyed) throw new Error("The editor is no longer available. Reopen the note and try again.");
      editor.chain().focus().setImage({ src: result.asset.url, alt: file.name }).run();
      props.notify("Image uploaded and inserted into the note.");
    } catch (cause) {
      // The server persists uploads before the editor embeds the reference.
      // Roll back an orphaned upload when insertion fails.
      if (uploadedAssetUrl) {
        try {
          await apiJson(uploadedAssetUrl, { method: "DELETE" });
        } catch {
          // Keep the original insertion error; orphan cleanup can be retried later.
        }
      }
      setError(cause instanceof Error ? cause.message : "Unable to upload this image.");
    } finally {
      setBusyUpload(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };

  const removeNote = async () => {
    if (!props.noteId || busyUpload || saving.current || saveState === "saving") return;
    if (dirty || saveState !== "saved") {
      setError("Save your changes before moving this note to Trash.");
      return;
    }
    if (!window.confirm("Move this note to Trash? You can restore it later.")) return;
    try {
      await apiJson("/api/notes/" + props.noteId, { method: "DELETE" });
      props.notify("Note moved to Trash.");
      props.onTopicsChanged();
      router.push("/all-notes");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to delete this note."); }
  };

  const exportImages = async () => {
    if (!props.noteId) return;
    try {
      const response = await fetch("/api/notes/" + props.noteId + "/images", { cache: "no-store" });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error || "Unable to export images."); }
      downloadBlob(await response.blob(), (title || "note").replace(/[\\/:*?"<>|]+/g, "-") + "-images.zip");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to export images."); }
  };

  const noteForTransfer: Note = {
    id: props.noteId || "", topicId, title, subject, content: editor?.getJSON() || EMPTY_DOC,
    tags, pinned, createdAt: "", updatedAt: ""
  };

  if (loading) return <div className="loading-panel"><Loader2 className="spin" />Opening your note…</div>;
  if (loadError) return (
    <div className="page-stack">
      <div className="inline-alert error" role="alert"><AlertCircle size={16} />{loadError}</div>
      <div className="form-footer">
        <button className="button-secondary" type="button" onClick={() => router.push("/all-notes")}>Back to notes</button>
        <button className="button-primary" type="button" onClick={() => setLoadAttempt(value => value + 1)}><RefreshCw size={15} /> Retry loading</button>
      </div>
    </div>
  );

  return (
    <div className="editor-page">
      <div className="editor-topline"><button type="button" className="back-link" onClick={() => router.push(topicId ? "/topics/" + topicId : "/all-notes")}><ArrowLeft size={15} /> Back</button>
        <div className={"save-indicator " + saveState}>{saveState === "saved" ? <CheckCircle2 size={14} /> : saveState === "saving" ? <Loader2 className="spin" size={14} /> : <Clock3 size={14} />}{saveState === "saved" ? "All changes saved" : saveState === "saving" ? "Saving…" : isNew ? "Not saved yet" : "Unsaved changes"}</div>
      </div>
      <div className="editor-layout">
        <main className="editor-main">
          <div className="editor-context-row"><span className="eyebrow">{isNew ? "New manuscript" : "Editing note"}</span>{pinned && <span className="pin-chip"><Pin size={12} /> Pinned</span>}</div>
          <input className="editor-title-input" disabled={creating} value={title} onChange={e => { setTitle(e.target.value); touchForm(); }} placeholder="Untitled note…" maxLength={180} aria-label="Note title" />
          <input className="editor-subtitle-input" disabled={creating} value={subject} onChange={e => { setSubject(e.target.value); touchForm(); }} placeholder="Add a short abstract or conceptual thesis…" maxLength={180} aria-label="Note subject" />
          <div className="editor-metadata-row">
            <label className="editor-topic-select"><Folder size={15} /><select disabled={creating} value={topicId} onChange={e => { setTopicId(e.target.value); touchForm(); }} aria-label="Collection">
              <option value="">Choose collection…</option>{props.topics.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select><ChevronDown size={14} /></label>
            <button type="button" disabled={creating} className={pinned ? "pin-toggle active" : "pin-toggle"} onClick={() => { setPinned(v => !v); touchForm(); }}><Pin size={14} /> {pinned ? "Pinned" : "Pin note"}</button>
            <div className="editor-tags">{tags.map(tag => <button type="button" key={tag} disabled={creating} onClick={() => { setTags(current => current.filter(t => t !== tag)); touchForm(); }} title={"Remove tag " + tag}>#{tag}<X size={11} /></button>)}
              <form className="tag-entry" onSubmit={e => { e.preventDefault(); addTag(); }}><input disabled={creating} value={tagInput} onChange={e => setTagInput(e.target.value)} placeholder="+ Add tag" aria-label="Add a tag" /><button type="submit" disabled={creating} aria-label="Add tag"><Plus size={14} /></button></form>
            </div>
          </div>
          <div className="editor-toolbar" role="toolbar" aria-label="Text formatting">
            <div className="toolbar-group">
              <button type="button" title="Paragraph" aria-label="Paragraph" className={editor?.isActive("paragraph") ? "tool-active" : ""} onClick={() => editor?.chain().focus().setParagraph().run()} disabled={creating}><Type size={16} /></button>
              <button type="button" title="Heading 1" aria-label="Heading 1" onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} disabled={creating}>H1</button>
              <button type="button" title="Heading 2" aria-label="Heading 2" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} disabled={creating}>H2</button>
              <button type="button" title="Heading 3" aria-label="Heading 3" onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} disabled={creating}>H3</button>
            </div>
            <span className="toolbar-divider" />
            <div className="toolbar-group">
              <button type="button" title="Bold" aria-label="Bold" className={editor?.isActive("bold") ? "tool-active" : ""} onClick={() => editor?.chain().focus().toggleBold().run()} disabled={creating}><Bold size={16} /></button>
              <button type="button" title="Italic" aria-label="Italic" className={editor?.isActive("italic") ? "tool-active" : ""} onClick={() => editor?.chain().focus().toggleItalic().run()} disabled={creating}><Italic size={16} /></button>
              <button type="button" title="Strikethrough" aria-label="Strikethrough" onClick={() => editor?.chain().focus().toggleStrike().run()} disabled={creating}><Strikethrough size={16} /></button>
              <button type="button" title="Inline code" aria-label="Inline code" onClick={() => editor?.chain().focus().toggleCode().run()} disabled={creating}><Code size={16} /></button>
            </div>
            <span className="toolbar-divider" />
            <div className="toolbar-group">
              <button type="button" title="Bulleted list" aria-label="Bulleted list" onClick={() => editor?.chain().focus().toggleBulletList().run()} disabled={creating}><List size={16} /></button>
              <button type="button" title="Numbered list" aria-label="Numbered list" onClick={() => editor?.chain().focus().toggleOrderedList().run()} disabled={creating}><ListOrdered size={16} /></button>
              <button type="button" title="Quote" aria-label="Quote" onClick={() => editor?.chain().focus().toggleBlockquote().run()} disabled={creating}><Quote size={16} /></button>
              <button type="button" title="Code block" aria-label="Code block" onClick={() => editor?.chain().focus().toggleCodeBlock().run()} disabled={creating}><Code size={16} /></button>
            </div>
            <span className="toolbar-divider" />
            <div className="toolbar-group">
              <button type="button" title="Insert image" aria-label="Insert image" disabled={creating || !props.noteId || busyUpload} onClick={() => uploadRef.current?.click()}>{busyUpload ? <Loader2 size={16} className="spin" /> : <ImagePlus size={16} />}</button>
              <button type="button" title="Toggle right-to-left writing" aria-label="Toggle right-to-left writing" className={rtl ? "tool-active" : ""} onClick={() => updateDirection(!rtl)} disabled={creating}>{rtl ? <AlignLeft size={16} /> : <AlignRight size={16} />}</button>
              <button type="button" title="Undo" aria-label="Undo" disabled={creating || !editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()}><Undo2 size={16} /></button>
              <button type="button" title="Redo" aria-label="Redo" disabled={creating || !editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()}><Redo2 size={16} /></button>
            </div>
            <input ref={uploadRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => void uploadImage(e.target.files?.[0])} />
          </div>
          <div className={"editor-canvas " + (rtl ? "rtl-editor" : "")}>
            {!props.noteId && <div className="editor-hint"><ImageIcon size={15} /> Save this note once to enable encrypted image attachments.</div>}
            <EditorContent editor={editor} />
          </div>
          {error && <div className="inline-alert error editor-alert"><AlertCircle size={16} />{error}</div>}
          <div className="editor-bottom">
            <span>{plainText(editor?.getJSON()).trim() ? plainText(editor?.getJSON()).trim().split(/\s+/).length + " words" : "Start writing when you're ready"}</span>
            <span>{props.noteId ? "Images up to 20 MB · PNG, JPEG, WebP, GIF" : "Your note is created when you save"}</span>
          </div>
        </main>
        <aside className="editor-side">
          <div className="editor-side-card">
            <div className="eyebrow">Writing space</div><h3>A little structure, plenty of room.</h3><p>Use headings to shape longer thoughts. Add tags for cross-topic discovery. Pin the notes you return to often.</p>
          </div>
          <div className="editor-side-card">
            <div className="eyebrow">This note</div>
            <div className="side-info"><span>Collection</span><b>{props.topics.find(t => t.id === topicId)?.title || "Not selected"}</b></div>
            <div className="side-info"><span>Tags</span><b>{tags.length}</b></div>
            <div className="side-info"><span>Saved state</span><b className={saveState}>{saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving" : "Changes pending"}</b></div>
          </div>
          <div className="editor-side-actions">
            <button type="button" className="button-primary full-button" disabled={busyUpload || saveState === "saving" || (!dirty && !isNew)} onClick={() => void saveNote(false)}><Save size={16} /> {busyUpload ? "Finishing image upload…" : isNew ? "Create note" : "Save changes"}</button>
            {props.noteId && <>
              <button type="button" className="button-secondary full-button" onClick={() => router.push("/notes/" + props.noteId + "/read")}><BookOpen size={16} /> Read this note</button>
              <button type="button" className="button-secondary full-button" onClick={() => saveMarkdown(title, editor?.getJSON())}><Download size={16} /> Export Markdown</button>
              <button type="button" className="button-secondary full-button" onClick={exportImages}><FileArchive size={16} /> Download images</button>
              <button type="button" className="button-secondary full-button" disabled={busyUpload} onClick={() => {
                if (dirty || saveState !== "saved") {
                  setError("Save your changes before moving or copying this note.");
                  return;
                }
                setTransferOpen(true);
              }}><ArrowDownUp size={16} /> Move or copy</button>
              <button type="button" className="button-danger full-button" disabled={busyUpload || saveState === "saving" || dirty || saveState !== "saved"} onClick={removeNote}><Trash2 size={16} /> Move to Trash</button>
            </>}
          </div>
        </aside>
      </div>
      {transferOpen && props.noteId && <MoveCopyDialog note={noteForTransfer} topics={props.topics} onClose={() => setTransferOpen(false)} onComplete={(action, destinationTopicId) => {
        if (action === "move") {
          setTopicId(destinationTopicId);
          persistedTopicId.current = destinationTopicId;
          setDirty(false);
          setSaveState("saved");
          setError("");
        }
        props.onTopicsChanged();
        router.refresh();
      }} notify={props.notify} />}
    </div>
  );
}

function ReaderPage(props: { noteId: string; onFocusMode: (value: boolean) => void; notify: (message: string) => void }) {
  const router = useRouter();
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [fontSize, setFontSize] = useState(18);
  const [toc, setToc] = useState<Array<{ id: string; title: string; level: number }>>([]);
  const [focus, setFocus] = useState(false);
  const editor = useEditor({ extensions: editorExtensions(), editable: false, content: EMPTY_DOC, immediatelyRender: false, editorProps: { attributes: { class: "tiptap-content reader-content" } } });

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    apiJson<{ note: Note }>("/api/notes/" + props.noteId).then(result => {
      if (!live) return;
      setNote(result.note);
      const headings: Array<{ id: string; title: string; level: number }> = [];
      const visit = (node: any) => {
        if (node?.type === "heading") headings.push({ id: "heading-" + headings.length, title: plainText(node), level: Number(node.attrs?.level || 2) });
        (node?.content || []).forEach(visit);
      };
      visit(result.note.content);
      setToc(headings);
      editor?.commands.setContent(result.note.content || EMPTY_DOC);
    }).catch(cause => { if (live) setError(cause instanceof Error ? cause.message : "Unable to open note."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [props.noteId, editor, loadAttempt]);

  useEffect(() => {
    if (!editor || !toc.length) return;
    const headings = editor.view.dom.querySelectorAll("h1,h2,h3");
    headings.forEach((element, index) => element.setAttribute("id", "heading-" + index));
  }, [editor, toc]);

  const toggleFocus = () => { const next = !focus; setFocus(next); props.onFocusMode(next); };
  useEffect(() => () => { props.onFocusMode(false); }, [props.onFocusMode]);
  useEffect(() => {
    if (!focus) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setFocus(false);
      props.onFocusMode(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [focus, props.onFocusMode]);
  if (loading) return <div className="loading-panel"><Loader2 className="spin" />Preparing reader…</div>;
  if (error || !note) return <div className="page-stack"><div className="inline-alert error" role="alert"><AlertCircle size={16} />{error || "Note not found."}</div><div className="form-footer"><button type="button" className="button-secondary" onClick={() => router.push("/all-notes")}><ArrowLeft size={16} /> Back to notes</button><button type="button" className="button-primary" onClick={() => setLoadAttempt(value => value + 1)}><RefreshCw size={15} /> Retry loading</button></div></div>;

  return (
    <div className={"reader-page " + (focus ? "reader-is-focused" : "")}>
      <div className="reader-toolbar"><div className="reader-toolbar-left"><button type="button" className="back-link" onClick={() => router.push("/all-notes")}><ArrowLeft size={15} /> Notes</button><span className="reader-divider" /><span className="reader-context">{note.topicTitle}</span></div>
        <div className="reader-toolbar-actions"><label className="font-size-control"><Type size={15} /><input type="range" min="16" max="24" value={fontSize} onChange={e => setFontSize(Number(e.target.value))} aria-label="Reading text size" /><span>{fontSize}px</span></label>
          <button type="button" className="icon-toolbar-button" title="Toggle focus mode" onClick={toggleFocus}>{focus ? <Maximize2 size={16} /> : <Eye size={16} />}<span>{focus ? "Exit focus" : "Focus mode"}</span></button>
          <button type="button" className="icon-toolbar-button" title="Edit note" onClick={() => router.push("/notes/" + note.id)}><Edit3 size={16} /><span>Edit</span></button>
          <button type="button" className="icon-toolbar-button" title="Export Markdown" onClick={() => saveMarkdown(note.title, note.content)}><Download size={16} /></button>
        </div>
      </div>
      <div className="reader-layout">
        <main className="reader-article">
          <div className="reader-kicker"><span className="topic-chip">{note.topicTitle}</span>{note.pinned && <span className="pin-chip"><Pin size={12} /> Pinned</span>}</div>
          <h1>{note.title || "Untitled note"}</h1>
          {note.subject && <p className="reader-abstract">{note.subject}</p>}
          <div className="reader-meta"><span>Created {formatDate(note.createdAt)}</span><span>Updated {relativeDate(note.updatedAt)}</span>{(note.tags || []).map(tag => <span key={tag} className="tag-chip">#{tag}</span>)}</div>
          <div className="reader-rule" />
          <article className="reader-prose" style={{ fontSize: fontSize + "px" }}><EditorContent editor={editor} style={{ fontSize: fontSize + "px" }} /></article>
          <div className="reader-endnote"><BookOpen size={17} /><span>End of note · <button type="button" onClick={() => router.push("/notes/" + note.id)}>Continue editing</button></span></div>
        </main>
        <aside className="reader-aside">
          {toc.length > 0 && <div className="reader-outline"><div className="eyebrow">On this page</div>{toc.map((heading, index) => <button type="button" key={heading.id} className={heading.level > 2 ? "outline-subitem" : ""} onClick={() => document.getElementById(heading.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}>{String(index + 1).padStart(2, "0")} <span>{heading.title}</span></button>)}</div>}
          <div className="reader-outline"><div className="eyebrow">Reading tools</div><button type="button" onClick={() => saveMarkdown(note.title, note.content)}><Download size={14} /><span>Export as Markdown</span></button><button type="button" onClick={() => router.push("/notes/" + note.id)}><Edit3 size={14} /><span>Edit this note</span></button></div>
        </aside>
      </div>
    </div>
  );
}

export default function ArchiveApp() {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const parts = pathname.split("/").filter(Boolean);
  const publicRoute = parts[0] === "login" || parts[0] === "register" || parts[0] === "verify-email";
  const [session, setSession] = useState<UserSession | null>(null);
  const [checking, setChecking] = useState(!publicRoute);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3600);
  }, []);

  const refreshTopics = useCallback(async () => {
    const [topicResult, categoryResult] = await Promise.allSettled([
      apiJson<{ topics: Topic[] }>("/api/topics"),
      apiJson<{ categories: string[] }>("/api/topics/categories")
    ]);
    if (topicResult.status === "fulfilled") setTopics(topicResult.value.topics || []);
    if (categoryResult.status === "fulfilled") setCategories(categoryResult.value.categories || []);
    if (topicResult.status === "rejected" || categoryResult.status === "rejected") {
      const cause = topicResult.status === "rejected" ? topicResult.reason : categoryResult.status === "rejected" ? categoryResult.reason : null;
      notify(cause instanceof Error ? cause.message : "Some collection navigation data could not be refreshed.");
    }
  }, [notify]);

  useEffect(() => {
    const saved = window.localStorage.getItem("mnemosyne-theme");
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);
  useEffect(() => {
    window.localStorage.setItem("mnemosyne-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (publicRoute) { setChecking(false); return; }
    let live = true;
    setChecking(true);
    apiJson<{ userId: string; email: string; displayName: string; expiresAt?: string }>("/api/vault/session")
      .then(result => {
        if (!live) return;
        setSession({ userId: result.userId, email: result.email, displayName: result.displayName, expiresAt: result.expiresAt });
      })
      .catch(() => {
        if (!live) return;
        setSession(null); router.replace("/login");
      })
      .finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
  }, [publicRoute, pathname, router]);

  useEffect(() => {
    if (!session || publicRoute) return;
    void refreshTopics();
  }, [session, publicRoute, refreshTopics]);

  useEffect(() => {
    if (!session || publicRoute) return;
    let lastActivity = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastActivity < 60_000) return;
      lastActivity = now;
      fetch("/api/vault/activity", { method: "POST", credentials: "same-origin", cache: "no-store" })
        .then(response => {
          if (response.status === 401) {
            setSession(null);
            router.replace("/login");
          }
        })
        .catch(() => undefined);
    };
    document.addEventListener("pointerdown", onActivity, { passive: true });
    document.addEventListener("pointermove", onActivity, { passive: true });
    document.addEventListener("scroll", onActivity, { passive: true, capture: true });
    document.addEventListener("keydown", onActivity);
    return () => {
      document.removeEventListener("pointerdown", onActivity);
      document.removeEventListener("pointermove", onActivity);
      document.removeEventListener("scroll", onActivity, true);
      document.removeEventListener("keydown", onActivity);
    };
  }, [session, publicRoute, router]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = Boolean(target && (
        target.matches("input, textarea, select") ||
        target.isContentEditable ||
        target.closest("button, a, [role='button']")
      ));
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); router.push("/search"); return;
      }
      if (event.key === "Escape") {
        setSidebarOpen(false);
        if (focusMode) setFocusMode(false);
        return;
      }
      if (editing || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key.toLowerCase() === "n") { event.preventDefault(); router.push("/notes/new"); }
      if (event.key.toLowerCase() === "t") { event.preventDefault(); router.push("/topics/new"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, focusMode]);

  const lockVault = async () => {
    try {
      await apiJson("/api/vault/lock", { method: "POST" });
      setSession(null);
      router.push("/login");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Unable to lock your archive. Your session is still active.");
    }
  };

  const exportArchive = async () => {
    try {
      const collected: Note[] = [];
      let offset = 0;
      let more = true;
      while (more) {
        const result = await apiJson<{ notes: Note[]; pagination: Pagination }>("/api/notes?limit=100&offset=" + offset);
        collected.push(...result.notes);
        more = Boolean(result.pagination?.hasMore);
        offset += result.pagination?.limit || result.notes.length;
        if (!result.notes.length) break;
      }
      const topicsById = new Map(topics.map(t => [t.id, t.title]));
      const body = collected.map(note => {
        const prefix = "\n\n---\n\n## Collection: " + (note.topicTitle || topicsById.get(note.topicId) || "Unsorted") + "\n\n";
        return prefix + noteToMarkdown(note.title, note.content, window.location.origin);
      }).join("");
      const markdown = "# Mnemosyne archive export\n\nExported " + formatDate(new Date().toISOString(), true) + "\n\nCollections: " + topics.length + "\nNotes: " + collected.length + body;
      downloadBlob(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), "mnemosyne-archive.md");
      notify("Archive Markdown export is ready.");
    } catch (cause) { notify(cause instanceof Error ? cause.message : "Unable to export the archive."); }
  };

  if (publicRoute) {
    if (parts[0] === "verify-email") return <VerificationPage />;
    return <AuthPage mode={parts[0] === "register" ? "register" : "login"} onAuthenticated={user => { setSession(user); router.replace("/"); }} />;
  }
  if (checking || !session) return <div className="app-boot"><div className="boot-mark"><BookOpen size={23} /></div><span>Opening your archive…</span></div>;

  const activeTitle = parts[0] === "topics" ? parts[1] ? (parts[2] === "edit" ? "Collection settings" : parts[1] === "new" ? "New collection" : topics.find(t => t.id === parts[1])?.title || "Collection") : "Topic collections"
    : parts[0] === "notes" ? parts[1] === "new" ? "New note" : parts[2] === "read" ? "Focus reader" : "Note editor"
      : parts[0] === "all-notes" ? "All notes" : parts[0] === "pinned" ? "Pinned notes" : parts[0] === "search" ? "Deep search" : parts[0] === "trash" ? "Trash" : parts[0] === "settings" ? "Settings" : parts.length === 0 ? "Overview" : "Not found";

  let page: React.ReactNode;
  if (parts[0] === "topics" && parts[1] === "new") page = <TopicForm topicId={null} topics={topics} onSaved={refreshTopics} onCancel={() => router.push("/topics")} notify={notify} />;
  else if (parts[0] === "topics" && parts[1] && parts[2] === "edit") page = <TopicForm topicId={parts[1]} topics={topics} onSaved={refreshTopics} onCancel={() => router.push("/topics/" + parts[1])} notify={notify} />;
  else if (parts[0] === "topics" && parts[1]) page = <TopicPage key={parts[1]} topicId={parts[1]} topics={topics} onRefreshTopics={refreshTopics} notify={notify} />;
  else if (parts[0] === "topics") page = <TopicsPage topics={topics} onOpen={id => router.push("/topics/" + id)} onCreate={() => router.push("/topics/new")} />;
  else if (parts[0] === "notes" && parts[1] === "new") page = <NoteEditorPage key={pathname} noteId={null} topics={topics} notify={notify} onTopicsChanged={refreshTopics} />;
  else if (parts[0] === "notes" && parts[1] && parts[2] === "read") page = <ReaderPage key={pathname} noteId={parts[1]} onFocusMode={setFocusMode} notify={notify} />;
  else if (parts[0] === "notes" && parts[1]) page = <NoteEditorPage key={pathname} noteId={parts[1]} topics={topics} notify={notify} onTopicsChanged={refreshTopics} />;
  else if (parts[0] === "all-notes") page = <NotesPage key="all" topics={topics} pinnedOnly={false} notify={notify} onTopicsChanged={refreshTopics} />;
  else if (parts[0] === "pinned") page = <NotesPage key="pinned" topics={topics} pinnedOnly notify={notify} onTopicsChanged={refreshTopics} />;
  else if (parts[0] === "search") page = <SearchPage topics={topics} notify={notify} />;
  else if (parts[0] === "trash") page = <TrashPage notify={notify} onTopicsChanged={refreshTopics} />;
  else if (parts[0] === "settings") page = <SettingsPage session={session} onLogout={lockVault} notify={notify} />;
  else if (parts.length === 0) page = <DashboardPage topics={topics} session={session} notify={notify} onTopicsChanged={refreshTopics} />;
  else page = <div className="page-stack"><EmptyState icon={<Search size={24} />} title="We couldn't find that page" description="The address may have changed, or the page may no longer exist." action={<button type="button" className="button-secondary" onClick={() => router.push("/")}>Return to overview</button>} /></div>;

  return (
    <div className={"mnemosyne-app theme-" + theme + (focusMode ? " focus-mode" : "")}>
      <div className="mobile-topbar"><button type="button" className="mobile-menu-button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={21} /></button><a href="/" className="mobile-brand"><span className="brand-mark"><BookOpen size={17} /></span>mnemosyne</a><button type="button" className="mobile-theme-button" onClick={() => setTheme(t => t === "dark" ? "light" : "dark")} title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button><button type="button" className="mobile-add-button" onClick={() => router.push("/notes/new")} aria-label="Create new note"><Plus size={19} /></button></div>
      <aside className="icon-rail">
        <a href="/" className="rail-brand" aria-label="Mnemosyne overview"><BookOpen size={21} /></a>
        <button type="button" className="rail-add" title="Quick capture · N" onClick={() => router.push("/notes/new")}><Plus size={20} /></button>
        <div className="rail-nav">
          <a href="/search" title="Deep search · Ctrl/⌘ K" className={parts[0] === "search" ? "active" : ""}><Search size={19} /></a>
          <a href="/" title="Knowledge dashboard" className={pathname === "/" ? "active" : ""}><LayoutDashboard size={19} /></a>
          <a href="/topics" title="Topic collections" className={parts[0] === "topics" ? "active" : ""}><Folder size={19} /></a>
          <a href="/all-notes" title="All notes" className={parts[0] === "all-notes" ? "active" : ""}><FileText size={19} /></a>
          <a href="/pinned" title="Pinned notes" className={parts[0] === "pinned" ? "active" : ""}><Pin size={19} /></a>
        </div>
        <div className="rail-bottom">
          <button type="button" title="Lock archive" onClick={lockVault}><Lock size={17} /></button>
          <button type="button" title="Toggle theme" onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button>
          <a href="/settings" title="Account settings"><Settings size={17} /></a>
          <div className="avatar-mark" title={session.displayName}>{(session.displayName || "M").slice(0, 1).toUpperCase()}</div>
        </div>
      </aside>
      <aside className={"workspace-sidebar " + (sidebarOpen ? "mobile-open" : "")}>
        <div className="sidebar-header">
          <div><b>Personal archive</b><span><StatusDot /> Session active</span></div>
          <button type="button" className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><X size={17} /></button>
        </div>
        <form className="sidebar-search" onSubmit={e => { e.preventDefault(); const input = (e.currentTarget.elements.namedItem("q") as HTMLInputElement); router.push("/search?q=" + encodeURIComponent(input.value)); setSidebarOpen(false); }}>
          <Search size={15} /><input name="q" placeholder="Search notes, tags…" /><kbd>Ctrl/⌘K</kbd>
        </form>
        <div className="sidebar-section">
          <div className="sidebar-section-label">Workspace</div>
          <a href="/" className={pathname === "/" ? "selected" : ""}><LayoutDashboard size={17} /><span>Overview</span></a>
          <a href="/all-notes" className={parts[0] === "all-notes" ? "selected" : ""}><FileText size={17} /><span>All notes</span><small>{topics.reduce((total, t) => total + Number(t.noteCount || 0), 0)}</small></a>
          <a href="/pinned" className={parts[0] === "pinned" ? "selected" : ""}><Pin size={17} /><span>Pinned notes</span></a>
          <a href="/search" className={parts[0] === "search" ? "selected" : ""}><Search size={17} /><span>Deep search</span></a>
        </div>
        <div className="sidebar-section collection-nav">
          <div className="sidebar-section-heading"><span className="sidebar-section-label">Topic collections</span><button type="button" title="Create a collection" onClick={() => { router.push("/topics/new"); setSidebarOpen(false); }}><Plus size={15} /></button></div>
          {topics.slice(0, 10).map(topic => <a key={topic.id} href={"/topics/" + topic.id} className={parts[0] === "topics" && parts[1] === topic.id ? "selected" : ""}><Folder size={16} /><span>{topic.title}</span><small>{topic.noteCount}</small></a>)}
          <a href="/topics" className="sidebar-see-all">Explore all collections <ArrowRight size={13} /></a>
        </div>
        {categories.length > 0 && <div className="sidebar-section tag-nav"><div className="sidebar-section-label">Categories</div><div className="sidebar-tags">{categories.slice(0, 7).map(category => <button type="button" key={category} onClick={() => { router.push("/topics?category=" + encodeURIComponent(category)); setSidebarOpen(false); }}><Tag size={11} />{category}</button>)}</div></div>}
        <div className="sidebar-footer">
          <a href="/trash" className={parts[0] === "trash" ? "selected" : ""}><Trash2 size={17} /><span>Trash</span></a>
          <a href="/settings" className={parts[0] === "settings" ? "selected" : ""}><KeyRound size={17} /><span>Account & security</span><ShieldCheck size={14} className="green-icon" /></a>
          <div className="account-mini"><div className="avatar-mini">{(session.displayName || "M").slice(0, 1).toUpperCase()}</div><div><b>{session.displayName}</b><small>{session.email}</small></div><button type="button" onClick={lockVault} title="Sign out"><LogOut size={15} /></button></div>
        </div>
      </aside>
      {sidebarOpen && <button type="button" className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <div className="app-main">
        {!focusMode && <header className="topbar">
          <div className="breadcrumbs"><span>Archive</span><ChevronRight size={13} /><b>{activeTitle}</b></div>
          <div className="topbar-right"><div className="vault-status"><StatusDot /><span>Encrypted archive</span></div><button type="button" className="button-secondary export-button" onClick={exportArchive}><Download size={15} /><span>Export Markdown</span></button><a className="button-primary topbar-create" href="/notes/new"><Plus size={16} /> Quick note</a><button type="button" className="topbar-lock" title="Lock vault now" onClick={lockVault}><Lock size={17} /></button></div>
        </header>}
        <main className="app-content">{page}</main>
      </div>
      {toast && <div className="toast-message" role="status"><CheckCircle2 size={16} />{toast}<button type="button" onClick={() => setToast("")} aria-label="Dismiss notification"><X size={14} /></button></div>}
      <nav className="mobile-bottom-nav"><a href="/" className={pathname === "/" ? "active" : ""}><LayoutDashboard size={19} /><span>Home</span></a><a href="/topics" className={parts[0] === "topics" ? "active" : ""}><Folder size={19} /><span>Topics</span></a><a href="/notes/new" className="mobile-bottom-create"><Plus size={20} /><span>New</span></a><a href="/all-notes" className={parts[0] === "all-notes" ? "active" : ""}><FileText size={19} /><span>Notes</span></a><a href="/search" className={parts[0] === "search" ? "active" : ""}><Search size={19} /><span>Search</span></a></nav>
    </div>
  );
}
