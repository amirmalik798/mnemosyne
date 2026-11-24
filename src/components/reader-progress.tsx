"use client";

import { useEffect, useRef, useState } from "react";

export function ReaderProgress() {
  const [progress, setProgress] = useState(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const update = () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = window.requestAnimationFrame(() => {
        const root = document.documentElement;
        const scrollableHeight = root.scrollHeight - window.innerHeight;
        const next = scrollableHeight <= 0
          ? 100
          : Math.min(100, Math.max(0, (window.scrollY / scrollableHeight) * 100));
        const rounded = Math.round(next);
        setProgress((current) => current === rounded ? current : rounded);
        frameRef.current = null;
      });
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(update)
      : null;
    if (resizeObserver) resizeObserver.observe(document.documentElement);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      resizeObserver?.disconnect();
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return (
    <div
      className="reader-progress"
      role="progressbar"
      aria-label="Reading progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress}
      aria-valuetext={`${progress}% read`}
    >
      <span style={{ width: `${progress}%` }} />
    </div>
  );
}
