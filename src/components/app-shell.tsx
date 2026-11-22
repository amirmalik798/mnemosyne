"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { BookOpen, Bookmark, Boxes, Command, FileText, FolderOpen, LockKeyhole, Pin, Plus, Search, Settings, ShieldCheck, Trash2 } from "lucide-react";
import { TopicDialog } from "@/components/topic-dialog";
import { FontSelector, ThemeToggle } from "@/components/theme-provider";
import { readResumeLocation, saveResumeLocation } from "@/lib/resume-location";
import { flushPendingLocalDraftWrites } from "@/lib/local-recovery";

const nav = [
  { label: "LIBRARY", items: [{ href: "/library", label: "Overview", icon: Boxes }, { href: "/topics", label: "All topics", icon: FolderOpen }, { href: "/notes", label: "All notes", icon: FileText }, { href: "/pinned", label: "Pinned notes", icon: Pin }, { href: "/search", label: "Search archive", icon: Search }] },
  { label: "PERSONAL", items: [{ href: "/trash", label: "Recently deleted", icon: Trash2 }, { href: "/settings", label: "Settings", icon: Settings }] },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const router = useRouter();
  const [showTopic, setShowTopic] = useState(false);
  const [locking, setLocking] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const lockForInactivity = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        saveResumeLocation();
        window.dispatchEvent(new Event("mnemosyne:flush-local-drafts"));
        await flushPendingLocalDraftWrites();
        await fetch("/api/vault/lock", { method: "POST" });
        window.location.assign("/unlock");
      }, 20 * 60 * 1000);
    };
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart", "scroll"];
    events.forEach((event) => window.addEventListener(event, lockForInactivity, { passive: true }));
    lockForInactivity();
    return () => { clearTimeout(timer); events.forEach((event) => window.removeEventListener(event, lockForInactivity)); };
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
    const lockWhenLeaving = (event: PageTransitionEvent) => {
      if (event.persisted) return;
      saveResumeLocation();
      // A browser-tab close or full page shutdown should invalidate the
      // server session. Next.js in-app navigation does not fire pagehide.
      void fetch("/api/vault/lock", {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
      }).catch(() => undefined);
    };

    window.addEventListener("scroll", persistScroll, { passive: true });
    window.addEventListener("pagehide", lockWhenLeaving);
    document.addEventListener("visibilitychange", persistWhenHidden);
    return () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      window.removeEventListener("scroll", persistScroll);
      window.removeEventListener("pagehide", lockWhenLeaving);
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
      await fetch("/api/vault/lock", { method: "POST" });
      router.replace("/unlock");
      router.refresh();
    } finally { setLocking(false); }
  }
  const current = nav.flatMap((group) => group.items).find((item) => pathname === item.href || (item.href !== "/library" && pathname.startsWith(`${item.href}/`)));
  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/library" className="brand"><span className="brand-mark">M</span><span><span className="brand-name">Mnemosyne</span><span className="brand-sub">Private knowledge archive</span></span></Link>
      {nav.map((group) => <div key={group.label}><div className="nav-label">{group.label}</div>{group.items.map((item) => { const Icon = item.icon; const active = current?.href === item.href; return <Link href={item.href} key={item.href} className={`nav-link ${active ? "active" : ""}`}><Icon /><span>{item.label}</span></Link>; })}</div>)}
      <div className="sidebar-spacer" />
      <div className="vault-status"><div className="status-row"><span className="dot" /> Vault encrypted</div><div className="vault-caption">Your private archive is unlocked for this session.</div></div>
      <div className="sidebar-bottom"><div className="profile"><div className="avatar">M</div><div className="profile-copy"><div className="profile-name">Personal vault</div><div className="profile-sub">Local archive</div></div></div><button className="icon-button" onClick={lockVault} disabled={locking} title="Lock vault" aria-label="Lock vault"><LockKeyhole /></button></div>
    </aside>
    <div className="main-area">
      <header className="topbar"><div className="breadcrumb"><span>MNEMOSYNE</span><span>/</span><span>{current?.label ?? (pathname.includes("/edit") ? "Edit note" : pathname.split("/").filter(Boolean).at(-1)?.replaceAll("-", " ") ?? "Overview")}</span></div>
        <div className="top-actions"><FontSelector /><ThemeToggle /><button className="search-trigger" onClick={() => router.push("/search")}><Search size={15} /><span>Search your archive…</span><kbd>⌘ K</kbd></button><button className="secondary-btn" onClick={() => router.push("/notes/new")}><Plus size={15} /> New note</button><button className="primary-btn" onClick={() => setShowTopic(true)}><Plus size={15} /><span>New topic</span></button></div>
      </header>
      {children}
    </div>
    {showTopic && <TopicDialog onClose={() => setShowTopic(false)} />}
  </div>;
}
