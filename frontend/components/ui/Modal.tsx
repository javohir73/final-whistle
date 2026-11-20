"use client";

/** The dialog shell: an ink scrim, a white 20px-radius panel near the top of
 *  the viewport, focus moved in on open and trapped, Escape and a scrim click
 *  close it, focus returns to whatever opened it, and the page behind does
 *  not scroll while it is open. Portaled to <body>.
 *
 *    <Modal open={open} onClose={close} labelledBy="signin-title">
 *      <ModalHead id="signin-title" title="Sign in" onClose={close} />
 *      <p className="mt-2 text-muted">Keep your picks across devices…</p>
 *      …
 *    </Modal>
 *
 *  `size="search"` = 640px wide with 12px padding (the search dialog).
 *  `initialFocus` = a ref to focus first; otherwise the first input, else
 *  the first focusable element. `returnFocus` = a ref to focus on close
 *  (default: whatever had focus when it opened).
 */
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "@/components/ui/Button";
import { CloseIcon } from "@/components/ui/Icons";
import { cn } from "@/lib/utils";

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  children,
  label,
  labelledBy,
  size = "default",
  initialFocus,
  returnFocus,
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Accessible name when there is no visible title. */
  label?: string;
  /** id of the visible title. */
  labelledBy?: string;
  size?: "default" | "search";
  initialFocus?: RefObject<HTMLElement | null>;
  /** Where focus goes on close; defaults to whatever had focus on open
   *  (pass the trigger: Safari does not focus a clicked button). */
  returnFocus?: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = returnFocus?.current ?? (document.activeElement as HTMLElement | null);
    const panel = panelRef.current;
    const target =
      initialFocus?.current ??
      panel?.querySelector<HTMLElement>("input:not([disabled]):not([type=hidden])") ??
      panel?.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();

    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      // Return focus to the control that opened the dialog (if still mounted).
      if (opener && document.contains(opener)) opener.focus();
    };
    // initialFocus is read once per open on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const current = document.activeElement;
    if (e.shiftKey && (current === first || !panelRef.current.contains(current))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (current === last || !panelRef.current.contains(current))) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      data-testid="modal-scrim"
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-ink/45 px-4 pb-4 pt-16 min-[900px]:pt-24"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        onKeyDown={onKeyDown}
        className={cn(
          "w-full rounded-dialog bg-ground text-ink shadow-dialog",
          size === "search" ? "max-w-[640px] p-3" : "max-w-[480px] p-5 min-[900px]:p-7",
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Title row of a dialog: 24px/600 heading and the round close button. */
export function ModalHead({
  id,
  title,
  onClose,
  closeLabel = "Close",
}: {
  id: string;
  title: ReactNode;
  onClose: () => void;
  closeLabel?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <h2 id={id} className="pt-1.5 text-2xl font-semibold tracking-[-0.01em] text-ink">
        {title}
      </h2>
      <IconButton label={closeLabel} onClick={onClose}>
        <CloseIcon />
      </IconButton>
    </div>
  );
}

/** A 52px, 12px-radius text field with its label above (".field"). */
export const FIELD_INPUT =
  "h-[52px] w-full rounded-input border border-line-strong bg-ground px-4 text-[17px] text-ink placeholder:text-muted focus-visible:border-brand";
