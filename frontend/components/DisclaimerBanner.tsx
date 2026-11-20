"use client";

import { useEffect, useState } from "react";

const DISMISSED_KEY = "finalwhistle:disclaimer-dismissed:v1";
const BANNER_ID = "fw-disclaimer";

// Runs while the HTML is parsed, right after the banner, so a reader who
// dismissed it never sees it flash in and then collapse at hydration (the
// classic pre-paint idiom). The
// inline display:none is what actually hides it: Tailwind's .flex comes
// after preflight's [hidden] rule in the compiled CSS, at equal specificity,
// so the attribute alone loses. `hidden` stays for assistive tech.
const PREPAINT =
  `try{if(localStorage.getItem(${JSON.stringify(DISMISSED_KEY)})==="1"){` +
  `var b=document.getElementById(${JSON.stringify(BANNER_ID)});` +
  `if(b){b.hidden=true;b.style.display="none"}}}catch(e){}`;

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false; // storage unavailable (private mode) — show it
  }
}

/** The "not betting advice" line: one quiet line on the soft ground,
 *  dismissible.
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
        className="border-b border-line bg-soft text-label text-muted"
      >
        <div className="fw-wrap flex min-h-[44px] items-center gap-2">
          <p className="min-w-0 flex-1 truncate">
            For analytics and entertainment only. Not betting advice.
            <span className="hidden sm:inline"> Predictions are probabilities, never guarantees.</span>
          </p>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss disclaimer"
            className="-mr-3 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted transition-colors hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: PREPAINT }} />
    </>
  );
}
