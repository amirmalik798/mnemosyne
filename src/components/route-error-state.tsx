"use client";

import Link from "next/link";
import { BookOpen, RefreshCw } from "lucide-react";
import { OperationStatus } from "@/components/operation-status";

export function RouteErrorState({ reset, errorReference, showLibraryLink = false }: { reset: () => void; errorReference?: string; showLibraryLink?: boolean }) {
  return (
    <main className="page protected-route-loading">
      <div>
        <div className="eyebrow">Mnemosyne</div>
        <h1 className="page-title">This page could not be opened</h1>
        <p className="page-subtitle">Something interrupted the request. You can retry or return to your archive.</p>
      </div>
      <OperationStatus kind="error" message="The page could not be displayed. You can retry or return to a safe starting point." />
      {errorReference && <p className="route-error-reference">Reference <code>{errorReference}</code></p>}
      <div className="route-error-actions">
        <button type="button" className="primary-btn route-error-action" onClick={reset}>
          <RefreshCw size={17} aria-hidden="true" /><span>Try again</span>
        </button>
        {showLibraryLink
          ? <Link className="secondary-btn route-error-action" href="/library"><BookOpen size={17} aria-hidden="true"/><span>Return to library</span></Link>
          : <Link className="secondary-btn route-error-action" href="/login"><BookOpen size={17} aria-hidden="true"/><span>Go to sign in</span></Link>}
      </div>
    </main>
  );
}
