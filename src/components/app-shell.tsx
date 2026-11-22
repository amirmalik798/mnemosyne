"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { BookOpen, Bookmark, Boxes, Command, FilePlus, FileText, FolderOpen, FolderPlus, LoaderCircle, LockKeyhole, Pin, Search, Settings, ShieldCheck, Trash2, X } from "lucide-react";
const TopicDialog = dynamic(
  () => import("@/components/topic-dialog").then((module) => module.TopicDialog),
  { loading: () => <OperationStatus kind="loading" message="Opening the topic editor…" /> },
);
import { ThemeToggle, useAppTheme } from "@/components/theme-provider";
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
  const { cycleFont } = useAppTheme();
  const [showTopic, setShowTopic] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandResults, setCommandResults] = useState<Array<{ id: string; href: string; title: string; detail: string }>>([]);
  const [commandIndex, setCommandIndex] = useState(0);
  const [commandSearchState, setCommandSearchState] = useState<"idle" | "waiting" | "loading" | "ready" | "error">("idle");
  const [commandSearchError, setCommandSearchError] = useState("");
  const [commandSearchAttempt, setCommandSearchAttempt] = useState(0);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const commandPreviousFocusRef = useRef<HTMLElement | null>(null);
  const commandItemsRef = useRef<Array<{ id: string; title: string; detail: string; run: () => void }>>([]);
  const [locking, setLocking] = useState(false);
  const [operationNotice, setOperationNotice] = useState<{ kind: OperationStatusKind; message: string } | null>(null);
  const operationNoticeTimerRef = useRef<number | null>(null);
  const redirectingToUnlockRef = useRef(false);

  function openCommandPalette() {
    commandPreviousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setCommandQuery("");
    setCommandIndex(0);
    setCommandSearchError("");
    setCommandSearchAttempt(0);
    setCommandOpen(true);
  }

  function closeCommandPalette(restoreFocus = true) {
    setCommandOpen(false);
    if (!restoreFocus) return;
    window.requestAnimationFrame(() => {
      const previous = commandPreviousFocusRef.current;
      if (previous?.isConnected && !previous.hasAttribute("disabled")) previous.focus();
      else document.querySelector<HTMLButtonElement>(".top-actions .search-trigger")?.focus();
      commandPreviousFocusRef.current = null;
    });
  }
  useEffect(() => {
    const activeAccountKey = "mnemosyne:active-account";
    const handleAccountChange = (event: StorageEvent) => {
      if (
        event.key === activeAccountKey &&
        typeof event.newValue === "string" &&
        event.newValue !== user.id
      ) {
        window.location.replace("/library");
      }
    };

    window.addEventListener("storage", handleAccountChange);
    try {
      // The value is an opaque account UUID, not a credential.
      window.localStorage.setItem(activeAccountKey, user.id);
    } catch {
      // The periodic server-side session identity check remains the fallback.
    }

    return () => window.removeEventListener("storage", handleAccountChange);
  }, [user.id]);

  useEffect(() => {
    const showOperationNotice = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: unknown; message?: unknown }>).detail;
      const allowedKinds: OperationStatusKind[] = ["loading", "waiting", "busy", "processing", "success", "error", "failure"];
      if (!detail || typeof detail.message !== "string" || !allowedKinds.includes(detail.kind as OperationStatusKind)) return;

      setOperationNotice({ kind: detail.kind as OperationStatusKind, message: detail.message });
      if (operationNoticeTimerRef.current !== null) window.clearTimeout(operationNoticeTimerRef.current);
      const isInProgress = detail.kind === "loading" || detail.kind === "waiting" || detail.kind === "busy" || detail.kind === "processing";
      if (!isInProgress) {
        operationNoticeTimerRef.current = window.setTimeout(() => {
          setOperationNotice(null);
          operationNoticeTimerRef.current = null;
        }, detail.kind === "error" || detail.kind === "failure" ? 7000 : 3800);
      }
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
      saveResumeLocation(user.id);
      window.dispatchEvent(new Event("mnemosyne:flush-local-drafts"));
      // Wait for the editor's final encrypted recovery write before leaving.
      // The sign-in screen explains when the device could not confirm the save.
      void flushPendingLocalDraftWrites()
        .then(() => window.location.replace("/login"))
        .catch(() => window.location.replace("/login?recovery=warning"));
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
        if (response.status === 401) {
          redirectToUnlock();
          return;
        }
        if (response.ok) {
          const sessionData = await response.json().catch(() => null) as { userId?: unknown } | null;
          if (typeof sessionData?.userId === "string" && sessionData.userId !== user.id) {
            // A different account became active in another tab. Force a full
            // document reload so no prior account's decrypted UI remains.
            window.location.replace("/library");
          }
        }
      } catch {
        // A temporary network failure is not proof that the vault session ended.
      }
    };

    const verifyWhenVisible = () => {
      if (document.visibilityState === "visible") void verifySession();
    };

    const interval = window.setInterval(() => {
      void verifySession();
    }, 60_000);
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
    const saved = readResumeLocation(user.id);

    if (saved?.href === currentHref) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => window.scrollTo(saved.scrollX, saved.scrollY));
      });
    } else {
      saveResumeLocation(user.id, { resetScroll: true });
    }

    let scrollTimer: ReturnType<typeof setTimeout> | undefined;
    const persistScroll = () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => saveResumeLocation(user.id), 220);
    };
    const persistWhenHidden = () => saveResumeLocation(user.id);
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
      const target = event.target;
      const isTyping = target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openCommandPalette();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        void lockVault();
        return;
      }
      if (isTyping) return;
      if (event.key === "/") {
        event.preventDefault();
        router.push("/search");
        requestAnimationFrame(() => document.getElementById("archive-search-input")?.focus());
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const links = Array.from(document.querySelectorAll<HTMLElement>(
          "a.note-row-main-link, a.topic-card, a.result-card, a.nav-link, a.mobile-nav-link",
        ));
        if (!links.length) return;
        const active = links.indexOf(document.activeElement as HTMLElement);
        if (active < 0 && event.key === "ArrowDown") {
          event.preventDefault();
          links[0].focus();
          return;
        }
        if (active >= 0) {
          event.preventDefault();
          links[Math.max(0, Math.min(links.length - 1, active + (event.key === "ArrowDown" ? 1 : -1)))].focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, commandOpen, locking]);
  async function lockVault() {
    if (locking) return;
    setLocking(true);
    notifyOperation("processing", "Saving pending drafts and locking your vault…");
    saveResumeLocation(user.id);
    window.dispatchEvent(new Event("mnemosyne:flush-local-drafts"));
    try {
      try {
        await flushPendingLocalDraftWrites();
      } catch {
        notifyOperation(
          "failure",
          "Your latest draft could not be confirmed in local recovery. The vault remains unlocked; check browser storage and try again.",
        );
        return;
      }

      const response = await fetch("/api/vault/lock", { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: unknown } | null;
        throw new Error(typeof payload?.error === "string" ? payload.error : "The server did not confirm the lock request.");
      }
      window.location.replace("/login");
    } catch (cause) {
      notifyOperation(
        "failure",
        cause instanceof Error
          ? "The vault could not be locked: " + cause.message
          : "The vault could not be locked. Check your connection and try again.",
      );
    } finally {
      setLocking(false);
    }
  }
  useEffect(() => {
    const cleanQuery = commandQuery.trim();
    if (!commandOpen || !cleanQuery) {
      setCommandResults([]);
      setCommandSearchState("idle");
      setCommandSearchError("");
      return;
    }
    const controller = new AbortController();
    setCommandResults([]);
    setCommandSearchState("waiting");
    setCommandSearchError("");
    const timer = window.setTimeout(async () => {
      if (controller.signal.aborted) return;
      setCommandSearchState("loading");
      try {
        const response = await fetch("/api/search?q=" + encodeURIComponent(cleanQuery), {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || "Archive search is temporarily unavailable.");
        const next = [
          ...(Array.isArray(data?.notes) ? data.notes.map((item: any) => ({
            id: "note:" + item.id,
            href: "/notes/" + item.id,
            title: item.title,
            detail: "Note · " + (item.topicTitle || "Archive"),
          })) : []),
          ...(Array.isArray(data?.topics) ? data.topics.map((item: any) => ({
            id: "topic:" + item.id,
            href: "/topics/" + item.id,
            title: item.title,
            detail: "Topic · " + (item.category || "Collection"),
          })) : []),
        ];
        if (!controller.signal.aborted) {
          setCommandResults(next.slice(0, 8));
          setCommandSearchState("ready");
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setCommandResults([]);
          setCommandSearchError(cause instanceof Error ? cause.message : "Archive search is temporarily unavailable.");
          setCommandSearchState("error");
        }
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [commandOpen, commandQuery, commandSearchAttempt]);

  const commandActions = [
    { id: "new-note", title: "New note", detail: "Create a new inscription", run: () => router.push("/notes/new") },
    { id: "new-topic", title: "New topic", detail: "Create an archive collection", run: () => setShowTopic(true) },
    { id: "theme", title: "Toggle dark / light mode", detail: "Change the archive appearance", run: () => document.querySelector<HTMLButtonElement>(".theme-toggle")?.click() },
    { id: "lock", title: "Lock vault", detail: "Save recovery drafts and lock this session", run: () => { void lockVault(); } },
    { id: "pinned", title: "Jump to pinned notes", detail: "Open your saved notes", run: () => router.push("/pinned") },
    { id: "font", title: "Switch interface font", detail: "Cycle to the next interface typeface", run: () => cycleFont() },
    { id: "search", title: "Search the archive", detail: "Find notes, topics and tags", run: () => router.push("/search") },
  ];
  const filteredActions = commandActions.filter((item) =>
    (item.title + " " + item.detail).toLocaleLowerCase().includes(commandQuery.toLocaleLowerCase()),
  );
  const commandItems = [
    ...filteredActions,
    ...commandResults.map((item) => ({ ...item, run: () => router.push(item.href) })),
  ].slice(0, 12);
  commandItemsRef.current = commandItems;

  function runCommandAt(index: number) {
    const item = commandItemsRef.current[index];
    if (!item) return;
    closeCommandPalette(false);
    item.run();
  }

  useEffect(() => {
    if (!commandOpen) return;
    setCommandIndex(0);
    requestAnimationFrame(() => commandInputRef.current?.focus());
  }, [commandOpen, commandQuery]);

  useEffect(() => {
    if (!commandOpen) return;
    const onPaletteKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown" && commandItemsRef.current.length) {
        event.preventDefault();
        setCommandIndex((value) => (value + 1) % commandItemsRef.current.length);
      } else if (event.key === "ArrowUp" && commandItemsRef.current.length) {
        event.preventDefault();
        setCommandIndex((value) => (value - 1 + commandItemsRef.current.length) % commandItemsRef.current.length);
      } else if (event.key === "Enter") {
        event.preventDefault();
        runCommandAt(commandIndex);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeCommandPalette();
      } else if (event.key === "Tab") {
        const focusable = Array.from(document.querySelectorAll<HTMLElement>(
          ".command-palette input, .command-palette button",
        ));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onPaletteKey);
    return () => window.removeEventListener("keydown", onPaletteKey);
  }, [commandOpen, commandIndex]);

  const current = nav.flatMap((group) => group.items).find((item) => pathname === item.href || (item.href !== "/library" && pathname.startsWith(`${item.href}/`)));
  const breadcrumbLabel = pathname === "/notes/new"
    ? "New note"
    : pathname.startsWith("/notes/")
      ? pathname.endsWith("/edit") ? "Edit note" : "Note"
      : pathname.startsWith("/topics/")
        ? pathname.endsWith("/edit") ? "Edit topic" : "Topic"
        : current?.label ?? "Overview";
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <aside className="sidebar">
      <Link href="/library" className="brand" aria-label="Mnemosyne library" title="Mnemosyne library"><span className="brand-mark">M</span><span><span className="brand-name">Mnemosyne</span><span className="brand-sub">Private knowledge archive</span></span></Link>
      <nav className="sidebar-navigation" aria-label="Archive navigation">
      {nav.map((group) => <div key={group.label}><div className="nav-label">{group.label}</div>{group.items.map((item) => { const Icon = item.icon; const active = current?.href === item.href; return <Link href={item.href} key={item.href} className={`nav-link ${active ? "active" : ""}`} aria-label={item.label} aria-current={active ? "page" : undefined} title={item.label}><Icon /><span>{item.label}</span></Link>; })}</div>)}
      </nav>
      <div className="sidebar-spacer" />
      <div className="vault-status"><div className="status-row"><span className="dot" /> Vault encrypted</div><div className="vault-caption">Your personal archive is unlocked for this session.</div></div>
      <div className="sidebar-bottom"><div className="profile"><div className="avatar">{(user.displayName.trim().charAt(0) || user.email.charAt(0)).toUpperCase()}</div><div className="profile-copy"><div className="profile-name">{user.displayName}</div><div className="profile-sub">{user.email}</div></div></div></div>
    </aside>
    <div className="main-area">
      <header className="topbar"><div className="breadcrumb"><span>MNEMOSYNE</span><span>/</span><span>{breadcrumbLabel}</span></div>
        <div className="top-actions" role="group" aria-label="Workspace actions"><ThemeToggle /><button type="button" className="search-trigger top-action-button" onClick={() => router.push("/search")} aria-label="Search your archive" title="Search your archive · /" aria-keyshortcuts="/"><Search size={17} aria-hidden="true" /><span>Search</span></button><button type="button" className="secondary-btn top-action-button" onClick={() => router.push("/notes/new")} aria-label="New note" title="New note"><FilePlus size={17} aria-hidden="true" /><span>New note</span></button><button type="button" className="primary-btn top-action-button" onClick={() => setShowTopic(true)} aria-label="Create a topic" title="Create a topic"><FolderPlus size={17} aria-hidden="true" /><span>New topic</span></button><button type="button" className="lock-vault-btn" onClick={lockVault} disabled={locking} title={locking ? "Locking vault…" : "Lock vault · Ctrl/⌘+L"} aria-label={locking ? "Locking vault" : "Lock vault"} aria-keyshortcuts="Control+L Meta+L">{locking ? <LoaderCircle className="operation-spinner" size={15} aria-hidden="true" /> : <LockKeyhole size={15} aria-hidden="true" />}<span>{locking ? "Locking…" : "Lock vault"}</span></button></div>
      </header>
      <div className="main-content" id="main-content" tabIndex={-1}>{children}</div>
    </div>
    <nav className="mobile-nav" aria-label="Main navigation">
      {nav.flatMap((group) => group.items).map((item) => {
        const Icon = item.icon;
        const active = current?.href === item.href;
        return <Link key={item.href} href={item.href} className={`mobile-nav-link ${active ? "active" : ""}`} aria-label={item.label} aria-current={active ? "page" : undefined} title={item.label}><Icon aria-hidden="true" /><span>{item.label}</span></Link>;
      })}
    </nav>
    {commandOpen && (
      <div
        className="command-palette-backdrop"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeCommandPalette();
        }}
      >
        <section className="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-palette-title" aria-describedby="command-palette-help">
          <div className="command-palette-input-wrap">
            <Command size={18} aria-hidden="true" />
            <input
              ref={commandInputRef}
              value={commandQuery}
              onChange={(event) => setCommandQuery(event.target.value)}
              placeholder="Search notes, topics, tags or run a command…"
              aria-label="Search and commands"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={true}
              aria-controls="command-palette-options"
              aria-activedescendant={commandItems.length ? `command-option-${Math.min(commandIndex, commandItems.length - 1)}` : undefined}
              aria-busy={commandSearchState === "waiting" || commandSearchState === "loading"}
            />
          </div>
          <div className="command-palette-label" id="command-palette-title">{commandQuery.trim() ? "Search results and commands" : "Quick actions"}</div>
          <p className="command-palette-help" id="command-palette-help">Use ↑ and ↓ to move, Enter to open, and Esc to close. Press Ctrl / ⌘ + K to reopen from anywhere.</p>
          <div className="command-palette-list" id="command-palette-options" role="listbox" aria-label="Commands and archive results" aria-busy={commandSearchState === "waiting" || commandSearchState === "loading"}>
            {commandItems.map((item, index) => (
              <button
                type="button"
                role="option"
                id={`command-option-${index}`}
                aria-selected={Math.min(commandIndex, commandItems.length - 1) === index}
                className={commandIndex === index ? "command-palette-item active" : "command-palette-item"}
                key={item.id}
                onMouseEnter={() => setCommandIndex(index)}
                onClick={() => runCommandAt(index)}
              >
                <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                <kbd>↵</kbd>
              </button>
            ))}
            {(commandSearchState === "waiting" || commandSearchState === "loading") && (
              <div className="command-palette-empty" role="status">Searching your encrypted archive…</div>
            )}
            {commandSearchState === "error" && (
              <div className="command-palette-search-error" role="alert">
                <span>{commandSearchError}</span>
                <button type="button" className="secondary-btn" onClick={() => setCommandSearchAttempt((value) => value + 1)}>Retry search</button>
              </div>
            )}
            {commandItems.length === 0 && commandSearchState !== "waiting" && commandSearchState !== "loading" && commandSearchState !== "error" && (
              <div className="command-palette-empty">
                {commandQuery.trim() ? "No matching notes, topics or commands." : "Start typing to search your encrypted archive."}
              </div>
            )}
          </div>
          <div className="command-palette-footer">
            <span>↑ ↓ Navigate</span><span>Enter Open / Run</span><span>Esc Close</span><kbd>Ctrl / ⌘ K</kbd>
          </div>
        </section>
      </div>
    )}
    {showTopic && <TopicDialog onClose={() => setShowTopic(false)} />}
    {operationNotice && (
      <div className="operation-toast">
        <OperationStatus kind={operationNotice.kind} message={operationNotice.message} />
        <button
          type="button"
          className="operation-toast-close icon-only-btn"
          onClick={() => {
            setOperationNotice(null);
            if (operationNoticeTimerRef.current !== null) window.clearTimeout(operationNoticeTimerRef.current);
          }}
          aria-label="Dismiss notification"
          title="Dismiss notification"
        >
          <X />
        </button>
      </div>
    )}
  </div>;
}
