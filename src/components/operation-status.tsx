"use client";

import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  XCircle,
  type LucideIcon,
} from "lucide-react";

export type OperationStatusKind = "loading" | "waiting" | "success" | "error" | "failure";

const STATUS_ICONS: Record<OperationStatusKind, LucideIcon> = {
  loading: LoaderCircle,
  waiting: Clock3,
  success: CheckCircle2,
  error: AlertCircle,
  failure: XCircle,
};

export function OperationStatus({
  kind,
  message,
  compact = false,
  className = "",
}: {
  kind: OperationStatusKind;
  message: string;
  compact?: boolean;
  className?: string;
}) {
  const Icon = STATUS_ICONS[kind];

  return (
    <div
      className={[
        "operation-status",
        `operation-status--${kind}`,
        compact ? "operation-status--compact" : "",
        className,
      ].filter(Boolean).join(" ")}
      role={kind === "error" || kind === "failure" ? "alert" : "status"}
      aria-live={kind === "error" || kind === "failure" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <Icon
        className={kind === "loading" ? "operation-status-icon operation-spinner" : "operation-status-icon"}
        aria-hidden="true"
      />
      <span>{message}</span>
    </div>
  );
}

export function notifyOperation(kind: OperationStatusKind, message: string) {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent("mnemosyne:operation-status", {
      detail: { kind, message },
    }),
  );
}
