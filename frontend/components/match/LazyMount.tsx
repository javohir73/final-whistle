"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Mounts `children` once its placeholder scrolls near the viewport, or when
 *  the reader asks for it. Used for the match page's lineups, which used to sit
 *  behind an Overview/Lineups tab: inline now, but their client fetch still
 *  waits until someone is about to see them. The placeholder is a real button,
 *  so keyboard and screen-reader users (who may never trigger a scroll) can
 *  load the content directly. */
export function LazyMount({
  children,
  label,
  rootMargin = "400px",
}: {
  children: ReactNode;
  /** The placeholder button's text, e.g. "Show lineups". */
  label: string;
  rootMargin?: string;
}) {
  const [show, setShow] = useState(false);
  const placeholder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (show) return;
    const el = placeholder.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShow(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShow(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [show, rootMargin]);

  if (show) return <>{children}</>;
  return (
    <div ref={placeholder} className="glass rounded-2xl p-6 text-center">
      <button
        type="button"
        onClick={() => setShow(true)}
        className="inline-flex min-h-[44px] items-center rounded-xl border border-border px-4 text-sm font-semibold text-foreground transition hover:border-win hover:text-lime-deep"
      >
        {label}
      </button>
    </div>
  );
}
