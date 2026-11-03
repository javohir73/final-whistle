"use client";

import { useEffect, useState } from "react";

const DISMISSED_KEY = "finalwhistle:disclaimer-dismissed:v1";
const BANNER_ID = "fw-disclaimer";

// Runs while the HTML is parsed, right after the banner, so a reader who
// dismissed it never sees it flash in and then collapse at hydration (the
// same pre-paint idiom as the theme boot script in app/layout.tsx).
const PREPAINT =
  `try{if(localStorage.getItem(${JSON.stringify(DISMISSED_KEY)})==="1"){` +
  `var b=document.getElementById(${JSON.stringify(BANNER_ID)});if(b)b.hidden=true}}catch(e){}`;

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false; // storage unavailable (private mode) — show it
  }
}

/** The "not betting advice" line, compact (one 32 px line) and dismissible.
 *  Dismissal is remembered on this device; the site footer carries the same
 *  compliance copy on every page regardless. */
export function DisclaimerBanner() {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (readDismissed()) setDismissed(true);
  }, []);

  if (dismissed) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* storage unavailable — dismiss for this page view only */
    }
    setDismissed(true);
  }

  return (
    <>
      <div
        id={BANNER_ID}
        role="note"
        // The pre-paint script may have set `hidden` before hydration.
        suppressHydrationWarning
        className="flex h-8 items-center gap-1 border-b border-border bg-surface pl-4 pr-1 text-label text-muted"
      >
        <p className="min-w-0 flex-1 truncate text-center">
          {/* The caution cue, in the AA-safe draw ink (an SVG, not an emoji). */}
          <svg
            viewBox="0 0 24 24"
            className="mr-1.5 inline-block h-3 w-3 -translate-y-px align-middle text-draw-ink"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            aria-hidden="true"
          >
            <path d="M12 3 2 20h20L12 3Z" strokeLinejoin="round" />
            <path d="M12 10v4M12 17h.01" strokeLinecap="round" />
          </svg>
          For analytics and entertainment only.{" "}
          <strong className="font-semibold text-foreground">Not betting advice.</strong>
          <span className="hidden sm:inline"> Predictions are probabilistic and never guaranteed.</span>
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss disclaimer"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted transition hover:text-foreground"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <script dangerouslySetInnerHTML={{ __html: PREPAINT }} />
    </>
  );
}
