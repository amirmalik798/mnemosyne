"use client";

import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

type Props = {
  label?: string;
  children: ReactNode;
  className?: string;
  panelClassName?: string;
};

export function ActionOverflowMenu({
  label = "More actions",
  children,
  className = "",
  panelClassName = "",
}: Props) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !detailsRef.current?.contains(event.target)) {
        if (detailsRef.current) detailsRef.current.open = false;
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !detailsRef.current?.open) return;
      event.preventDefault();
      event.stopPropagation();
      detailsRef.current.open = false;
      detailsRef.current.querySelector<HTMLElement>("summary")?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function closeAfterAction(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element) || target.closest("summary")) return;
    if (!target.closest("button:not(:disabled), a[href]")) return;
    window.requestAnimationFrame(() => {
      if (detailsRef.current) detailsRef.current.open = false;
    });
  }

  return (
    <details
      ref={detailsRef}
      className={["note-row-more", "action-overflow-menu", className].filter(Boolean).join(" ")}
    >
      <summary aria-label={label} title={label}>
        <MoreHorizontal size={19} aria-hidden="true" />
      </summary>
      <div
        className={["note-row-more-menu", panelClassName].filter(Boolean).join(" ")}
        role="group"
        aria-label={label}
        onClick={closeAfterAction}
      >
        {children}
      </div>
    </details>
  );
}
