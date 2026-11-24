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
      onToggle={(event) => {
        const details = event.currentTarget;
        if (!details.open) {
          delete details.dataset.menuSide;
          delete details.dataset.menuAlign;
          return;
        }
        details.dataset.menuSide = "below";
        requestAnimationFrame(() => {
          if (!details.isConnected || !details.open) return;
          const panel = details.querySelector<HTMLElement>(".note-row-more-menu");
          const trigger = details.querySelector<HTMLElement>("summary");
          if (!panel || !trigger) return;
          const triggerRect = trigger.getBoundingClientRect();
          const panelRect = panel.getBoundingClientRect();
          const phoneViewport = window.matchMedia("(max-width: 560px)").matches;
          const mobileNavRect = phoneViewport
            ? document.querySelector<HTMLElement>(".mobile-nav")?.getBoundingClientRect()
            : undefined;
          const stickyHeaderRect = phoneViewport
            ? document.querySelector<HTMLElement>(".topbar")?.getBoundingClientRect()
            : undefined;
          const reservedBottom = mobileNavRect ? Math.max(0, window.innerHeight - mobileNavRect.top) : 0;
          const reservedTop = stickyHeaderRect ? Math.max(0, stickyHeaderRect.bottom) : 0;
          const spaceBelow = window.innerHeight - triggerRect.bottom - reservedBottom;
          const spaceAbove = triggerRect.top - reservedTop;
          details.dataset.menuSide = spaceBelow < panelRect.height + 12 && spaceAbove > spaceBelow ? "above" : "below";
          details.dataset.menuAlign = triggerRect.right + panelRect.width > window.innerWidth - 12 ? "right" : "left";
        });
      }}
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
