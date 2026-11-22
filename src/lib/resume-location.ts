"use client";

export type ResumeLocation = {
  href: string;
  scrollX: number;
  scrollY: number;
  savedAt: number;
};

const STORAGE_KEY_PREFIX = "mnemosyne-resume-location:";

function storageKey(userId: string): string {
  return STORAGE_KEY_PREFIX + userId;
}

function isSafeInternalHref(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.origin === window.location.origin &&
      !parsed.pathname.startsWith("/api/") &&
      parsed.pathname !== "/unlock" &&
      parsed.pathname !== "/setup";
  } catch {
    return false;
  }
}

export function saveResumeLocation(userId: string, options: { resetScroll?: boolean } = {}): void {
  if (typeof window === "undefined" || !userId) return;
  const href = window.location.pathname + window.location.search + window.location.hash;
  if (!isSafeInternalHref(href)) return;

  const state: ResumeLocation = {
    href,
    scrollX: options.resetScroll ? 0 : window.scrollX,
    scrollY: options.resetScroll ? 0 : window.scrollY,
    savedAt: Date.now(),
  };
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(state));
  } catch {
    // Resume navigation is best-effort if browser storage is disabled.
  }
}

export function readResumeLocation(userId: string): ResumeLocation | null {
  if (typeof window === "undefined" || !userId) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ResumeLocation>;
    if (typeof value.href !== "string" || !isSafeInternalHref(value.href)) return null;
    return {
      href: value.href,
      scrollX: typeof value.scrollX === "number" ? value.scrollX : 0,
      scrollY: typeof value.scrollY === "number" ? value.scrollY : 0,
      savedAt: typeof value.savedAt === "number" ? value.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export function getResumeDestination(userId: string): string {
  return readResumeLocation(userId)?.href ?? "/library";
}
