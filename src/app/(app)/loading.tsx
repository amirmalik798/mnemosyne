"use client";

import { OperationStatus } from "@/components/operation-status";

export default function ProtectedRouteLoading() {
  return (
    <main className="page protected-route-loading" aria-busy="true">
      <OperationStatus kind="loading" message="Opening your archive…" />
      <div className="loading-skeleton" aria-hidden="true">
        <div className="loading-skeleton-line" />
        <div className="loading-skeleton-line" />
        <div className="loading-skeleton-line" />
        <div className="loading-skeleton-line" />
      </div>
    </main>
  );
}
