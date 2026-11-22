"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, ShieldCheck, X } from "lucide-react";

export type ConfirmationOptions = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  eyebrow?: string;
  tone?: "danger" | "neutral";
};

type ConfirmationDialogProps = {
  options: ConfirmationOptions;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmationDialog({
  options,
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    cancelRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancelRef.current();
        return;
      }

      if (event.key !== "Tab") return;
      const container = dialogRef.current;
      const focusable = container?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      );
      if (!focusable?.length || !container) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !container.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      previouslyFocused?.focus();
    };
  }, []);

  const isDanger = options.tone !== "neutral";

  return (
    <div className="confirmation-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section
        ref={dialogRef}
        className={`confirmation-dialog ${isDanger ? "confirmation-dialog-danger" : "confirmation-dialog-neutral"}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <div className="confirmation-dialog-top">
          <span className="confirmation-dialog-icon" aria-hidden="true">
            {isDanger ? <AlertTriangle size={21} /> : <ShieldCheck size={21} />}
          </span>
          <span className="confirmation-dialog-eyebrow">{options.eyebrow ?? (isDanger ? "Please confirm" : "Confirmation required")}</span>
          <button type="button" className="confirmation-dialog-close" onClick={onCancel} aria-label="Close confirmation">
            <X size={17} />
          </button>
        </div>
        <h2 className="confirmation-dialog-title" id={titleId}>{options.title}</h2>
        <p className="confirmation-dialog-description" id={descriptionId}>{options.description}</p>
        <div className="confirmation-dialog-actions">
          <button ref={cancelRef} type="button" className="secondary-btn confirmation-dialog-cancel" onClick={onCancel}>
            {options.cancelLabel ?? "Cancel"}
          </button>
          <button ref={confirmRef} type="button" className={isDanger ? "danger-btn confirmation-dialog-confirm" : "primary-btn confirmation-dialog-confirm"} onClick={onConfirm}>
            {options.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function useConfirmation() {
  const [options, setOptions] = useState<ConfirmationOptions | null>(null);
  const resolverRef = useRef<((accepted: boolean) => void) | null>(null);

  const confirm = useCallback((nextOptions: ConfirmationOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current?.(false);
      resolverRef.current = resolve;
      setOptions(nextOptions);
    });
  }, []);

  const settle = useCallback((accepted: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setOptions(null);
    resolve?.(accepted);
  }, []);

  useEffect(() => () => {
    resolverRef.current?.(false);
    resolverRef.current = null;
  }, []);

  const accept = useCallback(() => settle(true), [settle]);
  const cancel = useCallback(() => settle(false), [settle]);
  const dialog = options
    ? <ConfirmationDialog options={options} onConfirm={accept} onCancel={cancel} />
    : null;

  return { confirm, dialog };
}
