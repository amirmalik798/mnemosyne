"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
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
        <button type="button" className="primary-btn" onClick={reset}>
          <RefreshCw size={14} /> Try again
        </button>
        {showLibraryLink && <Link className="secondary-btn" href="/library">Return to library</Link>}
      </div>
    </main>
  );
}
