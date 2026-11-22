"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { BookOpen, Bookmark, Boxes, Command, FileText, FolderOpen, LoaderCircle, LockKeyhole, Pin, Plus, Search, Settings, ShieldCheck, Trash2, X } from "lucide-react";
const TopicDialog = dynamic(
  () => import("@/components/topic-dialog").then((module) => module.TopicDialog),
  { loading: () => null },
);
import { FontSelector, ThemeToggle } from "@/components/theme-provider";
import { readResumeLocation, saveResumeLocation } from "@/lib/resume-location";
import { flushPendingLocalDraftWrites } from "@/lib/local-recovery";
import { OperationStatus, notifyOperation, type OperationStatusKind } from "@/components/operation-status";

const nav = [
  { label: "LIBRARY", items: [{ href: "/library", label: "Overview", icon: Boxes }, { href: "/topics", label: "All topics", icon: FolderOpen }, { href: "/notes", label: "All notes", icon: FileText }, { href: "/pinned", label: "Pinned notes", icon: Pin }, { href: "/search", label: "Search archive", icon: Search }] },
  { label: "PERSONAL", items: [{ href: "/trash", label: "Recently deleted", icon: Trash2 }, { href: "/settings", label: "Settings", icon: Settings }] },
];

export function AppShell({ children, user }: { children: React.ReactNode; user: { id: string; email: string; displayName: string } }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const router = useRouter();
  const [showTopic, setShowTopic] = useState(false);
  const [locking, setLocking] = useState(false);
  const [operationNotice, setOperationNotice] = useState<{ kind: OperationStatusKind; message: string } | null>(null);
  const operationNoticeTimerRef = useRef<number | null>(null);
  const redirectingToUnlockRef = useRef(false);
  useEffect(() => {
    const showOperationNotice = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: unknown; message?: unknown }>).detail;
      const allowedKinds: OperationStatusKind[] = ["loading", "waiting", "success", "error", "failure"];
      if (!detail || typeof detail.message !== "string" || !allowedKinds.includes(detail.kind as OperationStatusKind)) return;

      setOperationNotice({ kind: detail.kind as OperationStatusKind, message: detail.message });
      if (operationNoticeTimerRef.current !== null) window.clearTimeout(operationNoticeTimerRef.current);
      operationNoticeTimerRef.current = window.setTimeout(() => {
        setOperationNotice(null);
        operationNoticeTimerRef.current = null;
      }, detail.kind === "error" || detail.kind === "failure" ? 7000 : 3800);
    };

    window.addEventListener("mnemosyne:operation-status", showOperationNotice);
    return () => {
      window.removeEventListener("mnemosyne:operation-status", showOperationNotice);
      if (operationNoticeTimerRef.current !== null) window.clearTimeout(operationNoticeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const nativeFetch = window.fetch.bind(window);

    const redirectToUnlock = () => {
      if (redirectingToUnlockRef.current || window.location.pathname === "/login") return;
      redirectingToUnlockRef.current = true;

      // Preserve the current workspace while the expired session is re-authenticated.
      // No logout request is sent here; the server has already rejected the session.
      saveResumeLocation();
      window.dispatchEvent(new Event("mnemosyne:flush-local-drafts"));
      void flushPendingLocalDraftWrites();
      window.location.replace("/login");
    };

    const guardedFetch: typeof window.fetch = async (input, init) => {
      const response = await nativeFetch(input, init);
      if (response.status !== 401) return response;

      let requestPath = "";
      try {
        const requestUrl = input instanceof Request ? input.url : String(input);
        const parsedUrl = new URL(requestUrl, window.location.href);
        if (parsedUrl.origin === window.location.origin) requestPath = parsedUrl.pathname;
      } catch {
        // Non-URL fetch inputs are not session-protected application requests.
      }

      if (
        requestPath.startsWith("/api/") &&
        requestPath !== "/api/vault/unlock"
      ) {
        // Only the shared auth middleware message means the session itself
        // expired. Other 401 responses (for example, an incorrect current
        // password during password change) are operation-level failures and
        // must not eject the user from an otherwise valid session.
        let sessionExpired = false;
        try {
          const payload = await response.clone().json() as { error?: unknown };
          sessionExpired = payload.error === "Please sign in to your account.";
        } catch {
          // Unknown 401 response formats are not sufficient evidence to log out.
        }
        if (sessionExpired) redirectToUnlock();
      }
      return response;
    };

    window.fetch = guardedFetch;

    const verifySession = async () => {
      if (redirectingToUnlockRef.current || document.visibilityState !== "visible") return;
      try {
        const response = await nativeFetch("/api/vault/session", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });
        if (response.status === 401) redirectToUnlock();
      } catch {
        // A temporary network failure is not proof that the vault session ended.
      }
    };

    const verifyWhenVisible = () => {
      if (document.visibilityState === "visible") void verifySession();
    };

    const interval = window.setInterval(() => {
      void verifySession();
    }, 15_000);
    window.addEventListener("focus", verifyWhenVisible);
    document.addEventListener("visibilitychange", verifyWhenVisible);
    void verifySession();

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", verifyWhenVisible);
      document.removeEventListener("visibilitychange", verifyWhenVisible);
      if (window.fetch === guardedFetch) window.fetch = nativeFetch;
    };
  }, []);

  useEffect(() => {
    let lastActivityPingAt = 0;
    const reportActivity = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      // Coalesce frequent pointer/scroll/keyboard events. The server remains
      // the authority for the 20-minute idle and 12-hour absolute expiries.
      if (now - lastActivityPingAt < 60_000) return;
      lastActivityPingAt = now;
      void fetch("/api/vault/activity", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      }).catch(() => {
        // Temporary network trouble must not invalidate an otherwise valid
        // session. The next interaction can retry after the throttle window.
      });
    };

    const events: Array<keyof WindowEventMap> = ["pointerdown", "pointermove", "keydown", "touchstart", "scroll"];
    events.forEach((event) => window.addEventListener(event, reportActivity, { passive: true }));
    document.addEventListener("visibilitychange", reportActivity);
    return () => {
      events.forEach((event) => window.removeEventListener(event, reportActivity));
      document.removeEventListener("visibilitychange", reportActivity);
    };
  }, []);

  // Remember the exact protected route and scroll position. On return from
  // the vault lock screen, restore the same workspace view.
  useEffect(() => {
    const currentHref = window.location.pathname + window.location.search + window.location.hash;
    const saved = readResumeLocation();

    if (saved?.href === currentHref) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => window.scrollTo(saved.scrollX, saved.scrollY));
      });
    } else {
      saveResumeLocation({ resetScroll: true });
    }

    let scrollTimer: ReturnType<typeof setTimeout> | undefined;
    const persistScroll = () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => saveResumeLocation(), 220);
    };
    const persistWhenHidden = () => saveResumeLocation();
    // A reload, full-page navigation, or closing one tab is not an explicit
    // vault-lock request. Persist navigation state only; the shared server
    // session expires by idle/absolute timeout or a deliberate Lock action.

    window.addEventListener("scroll", persistScroll, { passive: true });
    window.addEventListener("pagehide", persistWhenHidden);
    document.addEventListener("visibilitychange", persistWhenHidden);
    return () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      window.removeEventListener("scroll", persistScroll);
      window.removeEventListener("pagehide", persistWhenHidden);
      document.removeEventListener("visibilitychange", persistWhenHidden);
    };
  }, [pathname, searchKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); router.push("/search"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
  async function lockVault() {
    setLocking(true);
    saveResumeLocation();
    window.dispatchEvent(new Event("mnemosyne:flush-local-drafts"));
    try {
      await flushPendingLocalDraftWrites();
      const response = await fetch("/api/vault/lock", { method: "POST" });
      if (!response.ok) throw new Error("The server did not confirm the lock request.");
      router.replace("/login");
      router.refresh();
    } catch {
      notifyOperation("error", "The vault could not be locked. Check your connection and try again.");
    } finally {
      setLocking(false);
    }
  }
  const current = nav.flatMap((group) => group.items).find((item) => pathname === item.href || (item.href !== "/library" && pathname.startsWith(`${item.href}/`)));
  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/library" className="brand"><span className="brand-mark">M</span><span><span className="brand-name">Mnemosyne</span><span className="brand-sub">Private knowledge archive</span></span></Link>
      {nav.map((group) => <div key={group.label}><div className="nav-label">{group.label}</div>{group.items.map((item) => { const Icon = item.icon; const active = current?.href === item.href; return <Link href={item.href} key={item.href} className={`nav-link ${active ? "active" : ""}`}><Icon /><span>{item.label}</span></Link>; })}</div>)}
      <div className="sidebar-spacer" />
      <div className="vault-status"><div className="status-row"><span className="dot" /> Vault encrypted</div><div className="vault-caption">Your personal archive is unlocked for this session.</div></div>
      <div className="sidebar-bottom"><div className="profile"><div className="avatar">{(user.displayName.trim().charAt(0) || user.email.charAt(0)).toUpperCase()}</div><div className="profile-copy"><div className="profile-name">{user.displayName}</div><div className="profile-sub">{user.email}</div></div></div></div>
    </aside>
    <div className="main-area">
      <header className="topbar"><div className="breadcrumb"><span>MNEMOSYNE</span><span>/</span><span>{current?.label ?? (pathname.includes("/edit") ? "Edit note" : pathname.split("/").filter(Boolean).at(-1)?.replaceAll("-", " ") ?? "Overview")}</span></div>
        <div className="top-actions"><FontSelector /><ThemeToggle /><button className="search-trigger" onClick={() => router.push("/search")}><Search size={15} /><span>Search your archive…</span><kbd>⌘ K</kbd></button><button className="secondary-btn" onClick={() => router.push("/notes/new")}><Plus size={15} /> New note</button><button className="primary-btn" onClick={() => setShowTopic(true)}><Plus size={15} /><span>New topic</span></button><button type="button" className="lock-vault-btn" onClick={lockVault} disabled={locking} title={locking ? "Locking vault…" : "Lock vault"} aria-label={locking ? "Locking vault" : "Lock vault"}>{locking ? <LoaderCircle className="operation-spinner" size={15} /> : <LockKeyhole size={15} />}<span>{locking ? "Locking…" : "Lock vault"}</span></button></div>
      </header>
      {children}
    </div>
    {showTopic && <TopicDialog onClose={() => setShowTopic(false)} />}
    {operationNotice && (
      <div className="operation-toast">
        <OperationStatus kind={operationNotice.kind} message={operationNotice.message} />
        <button
          type="button"
          className="operation-toast-close"
          onClick={() => {
            setOperationNotice(null);
            if (operationNoticeTimerRef.current !== null) window.clearTimeout(operationNoticeTimerRef.current);
          }}
          aria-label="Dismiss notification"
        >
          <X />
        </button>
      </div>
    )}
  </div>;
}
