"use client";

import { useEffect, useState } from "react";
import { Focus, Minimize2 } from "lucide-react";

export function ReaderFocusToggle() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("reader-focus-active", active);

    if (!active) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setActive(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      root.classList.remove("reader-focus-active");
    };
  }, [active]);

  return (
    <button
      type="button"
      className="reader-focus-toggle"
      onClick={() => setActive((current) => !current)}
      aria-pressed={active}
      aria-label={active ? "Exit reading focus mode" : "Enter reading focus mode"}
      aria-keyshortcuts={active ? "Escape" : undefined}
      title={active ? "Exit focus mode · Esc" : "Focus reading"}
    >
      {active
        ? <Minimize2 size={16} aria-hidden="true" />
        : <Focus size={16} aria-hidden="true" />}
      <span>{active ? "Exit focus" : "Focus reading"}</span>
    </button>
  );
}
