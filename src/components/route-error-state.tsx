"use client";

import Link from "next/link";
import { BookOpen, RefreshCw } from "lucide-react";
import { OperationStatus } from "@/components/operation-status";

export function RouteErrorState({ reset, showLibraryLink = false }: { reset: () => void; showLibraryLink?: boolean }) {
  return (
    <main className="page protected-route-loading">
      <div>
        <div className="eyebrow">Mnemosyne</div>
        <h1 className="page-title">This page could not be opened</h1>
        <p className="page-subtitle">Something interrupted the request. You can retry or return to your archive.</p>
      </div>
      <OperationStatus kind="error" message="The page could not be displayed. Please try again." />
      <div className="route-error-actions">
        <button type="button" className="primary-btn icon-only-btn" onClick={reset} aria-label="Try again" title="Try again">
          <RefreshCw size={17} />
        </button>
        {showLibraryLink && <Link className="secondary-btn icon-only-btn" href="/library" aria-label="Return to library" title="Return to library"><BookOpen size={17}/></Link>}
      </div>
    </main>
  );
}
