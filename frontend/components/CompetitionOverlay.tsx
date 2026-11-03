"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { CompetitionLogo } from "@/components/CompetitionLogo";
import { useCompetitionScope, usePreferredCompetition } from "@/components/TournamentProvider";
import { COMPETITIONS, accentInkVar, type Competition, type CompetitionId } from "@/lib/sports";
import { clearCompetitionCookie, writeCompetitionCookie } from "@/lib/competitionPrefs";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/** Display order and grouping. Finished tournaments (registry `archived`)
 *  move to their own section instead of sitting among live competitions. */
const SECTIONS: Array<{ heading: string; includes: (c: Competition) => boolean }> = [
  { heading: "Football", includes: (c) => c.sport === "football" && !c.archived },
  { heading: "Rugby league", includes: (c) => c.sport === "nrl" && !c.archived },
  { heading: "Past tournaments", includes: (c) => c.archived },
];

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden="true"
    >
      <path
        d="M12 3.5l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.4l-5.4 2.9 1-6.1L3.2 10l6.1-.9L12 3.5Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Header chip + full-screen competition switcher. Shown on every route: the
 *  chip names the competition the shell is scoped to (SiteNav passes it in;
 *  standalone it resolves the same scope itself). The star sets the default
 *  competition -- the fw_comp cookie the server reads (lib/competitionPrefs.ts)
 *  -- so it now changes what /, /play and /leaderboard open on, instead of
 *  only reordering this list. */
export function CompetitionOverlay({ competition }: { competition?: CompetitionId }) {
  const scope = useCompetitionScope();
  const active = competition ?? scope.competition;
  const preferred = usePreferredCompetition();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  // Move focus into the dialog when it opens (the close button, first in tab
  // order), and close on Escape from anywhere.
  useEffect(() => {
    if (!open) return;
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Focus trap: Tab and Shift+Tab cycle inside the dialog.
  const onDialogKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const current = document.activeElement;
    if (e.shiftKey && (current === first || !dialogRef.current.contains(current))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (current === last || !dialogRef.current.contains(current))) {
      e.preventDefault();
      first.focus();
    }
  };

  const choose = (id: CompetitionId) => {
    if (id !== active) {
      // Written now rather than left to the navigation, so the provider's
      // URL sync sees no change and the switch is counted once, as "switcher".
      writeCompetitionCookie(id);
      trackEvent("competition_switch", { from: active, to: id, source: "switcher" });
    }
    close();
  };

  const toggleDefault = (id: CompetitionId) => {
    if (preferred === id) {
      clearCompetitionCookie();
      return;
    }
    writeCompetitionCookie(id);
    trackEvent("competition_switch", { from: preferred ?? active, to: id, source: "set_default" });
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="ml-2 inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-2 py-1.5 text-body font-semibold text-foreground transition hover:bg-surface sm:ml-4 sm:gap-2 sm:px-2.5"
      >
        <CompetitionLogo competition={active} size={24} />
        {/* Below sm the logo carries the identity on its own. The header has
            to fit the brand mark, this trigger, Premium, the theme toggle and
            Sign in inside 320px; the short label is ~40px of that budget and
            the only element here that is genuinely redundant.
            sr-only/not-sr-only rather than hidden/inline plus a second sr-only
            copy: one node means the button's accessible name is "EPL" at every
            width instead of "EPL EPL" wherever CSS hasn't resolved. */}
        <span className="sr-only sm:not-sr-only">{COMPETITIONS[active].shortLabel}</span>
        <ChevronIcon />
      </button>

      {/* Portaled to <body>: SiteNav's header has backdrop-blur, and any
          backdrop-filter creates a containing block for fixed descendants --
          rendered inline, "inset-0" would resolve against the 60px header
          strip instead of the viewport. Safe to touch document.body here:
          `open` is only ever true after mount. */}
      {open &&
        createPortal(
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Choose a competition"
            className="fixed inset-0 z-[60] overflow-y-auto bg-background/95 backdrop-blur-xl"
            onClick={close}
            onKeyDown={onDialogKeyDown}
          >
            <div
              className="mx-auto max-w-3xl px-6 py-16 sm:py-24"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="fixed right-5 top-5 grid h-11 w-11 place-items-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground"
              >
                <CloseIcon />
              </button>

              {SECTIONS.map(({ heading, includes }) => {
                const list = Object.values(COMPETITIONS).filter(includes);
                if (list.length === 0) return null;
                return (
                  <section key={heading} className="mb-12 last:mb-0">
                    <h2 className="mb-4 text-label font-semibold uppercase tracking-[0.08em] text-muted">
                      {heading}
                    </h2>
                    <ul>
                      {list.map((c) => {
                        const isActive = c.id === active;
                        const isDefault = preferred === c.id;
                        // "NRL NRL": the code chip only earns its place when
                        // it says something the name does not.
                        const showCode =
                          c.shortLabel.toLowerCase() !== c.label.toLowerCase();
                        const row = (
                          <>
                            <CompetitionLogo competition={c.id} size={42} />
                            <span
                              className={cn(
                                "font-display text-3xl font-bold tracking-tight sm:text-5xl",
                                isActive
                                  ? "text-lime-deep"
                                  : c.enabled
                                  ? "text-foreground"
                                  : "text-muted"
                              )}
                            >
                              {c.label}
                            </span>
                            {showCode && (
                              <span
                                aria-hidden="true"
                                className="rounded-full px-2 py-0.5 text-label font-bold uppercase tracking-wide"
                                style={{
                                  backgroundColor: `hsl(var(${c.accentVar}) / 0.12)`,
                                  // Shared with CompEyebrowChip. These two used
                                  // to carry separate inline ternaries and had
                                  // already drifted apart — the eyebrow routed
                                  // NRL through its ink, this one did not.
                                  color: `hsl(var(${accentInkVar(c.id)}))`,
                                }}
                              >
                                {c.shortLabel}
                              </span>
                            )}
                            {!c.enabled && (
                              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-label font-semibold uppercase tracking-wide text-muted">
                                Soon
                              </span>
                            )}
                          </>
                        );
                        return (
                          <li
                            key={c.id}
                            className="flex items-center gap-3 border-b border-border py-4 last:border-0"
                          >
                            {c.enabled ? (
                              <Link
                                href={c.basePath}
                                onClick={() => choose(c.id)}
                                aria-current={isActive ? "page" : undefined}
                                className="flex flex-1 flex-wrap items-center gap-3"
                              >
                                {row}
                              </Link>
                            ) : (
                              <div
                                aria-disabled="true"
                                className="flex flex-1 flex-wrap items-center gap-3"
                              >
                                {row}
                              </div>
                            )}
                            {c.enabled && (
                              <button
                                type="button"
                                onClick={() => toggleDefault(c.id)}
                                // A toggle keeps one name; aria-pressed carries
                                // the state ("Set NRL as default, pressed").
                                aria-pressed={isDefault}
                                aria-label={`Set ${c.label} as default`}
                                title={isDefault ? "Your default competition" : "Set as default"}
                                className={cn(
                                  "grid h-11 w-11 shrink-0 place-items-center rounded-full transition hover:bg-surface-2 hover:text-foreground",
                                  isDefault ? "text-lime-deep" : "text-muted"
                                )}
                              >
                                <StarIcon filled={isDefault} />
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
