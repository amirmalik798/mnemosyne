"use client";

import { OperationStatus } from "@/components/operation-status";

export default function ApplicationLoading() {
  return (
    <main className="page protected-route-loading" aria-busy="true">
      <OperationStatus kind="loading" message="Loading Mnemosyne…" />
      <div className="loading-skeleton" aria-hidden="true">
        <div className="loading-skeleton-line" />
        <div className="loading-skeleton-line" />
        <div className="loading-skeleton-line" />
        <div className="loading-skeleton-line" />
      </div>
    </main>
  );
}
