"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "@/lib/session";
import { FIELD_INPUT, GhostButton } from "@/components/ui";

/** Controls Tab may land on inside the dialog. Disabled buttons are skipped:
 *  the submit button is disabled until a password is typed, and wrapping onto
 *  a control that can't take focus would let Tab escape the dialog. */
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** The menu button this dialog belongs to: an [aria-haspopup] control that is
 *  a direct sibling of the dialog (AccountMenu renders both inside its
 *  wrapper). Deliberately that narrow, so a dialog used anywhere else can't
 *  hand focus to some unrelated popup button further up the page. */
function siblingMenuButton(dialog: HTMLElement | null): HTMLElement | null {
  return dialog?.parentElement?.querySelector<HTMLElement>(":scope > [aria-haspopup]") ?? null;
}

/** Confirm dialog for permanent account deletion. Re-auth (password) is required;
 *  on success the account is anonymized server-side and the caller is signed out.
 *  Presentational — the actual deletion happens in `onConfirm`.
 *
 *  A real modal for keyboard and screen-reader users: focus moves in on open,
 *  Tab/Shift+Tab cycle inside the card, Escape closes, and focus returns on
 *  close -- to `returnFocusRef` when given, else to the element that opened
 *  the dialog, else (that element is gone: the account menu's "Delete
 *  account" item unmounts with its menu in the same click) to the menu button
 *  the dialog sits beside. */
export function DeleteAccountModal({
  open,
  onClose,
  onConfirm,
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (password: string) => Promise<void>;
  /** Where focus goes on close, when the caller knows better than the DOM. */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const uid = useId();
  const titleId = `${uid}-title`;
  const passwordId = `${uid}-password`;

  useEffect(() => {
    if (open) {
      setError(null);
      setPassword("");
      setTimeout(() => firstField.current?.focus(), 0);
    }
  }, [open]);

  // Return focus once the dialog closes. Decided at open, while the dialog is
  // mounted: the opener if it is still a real, live element, else the menu
  // button beside the dialog (focus had already fallen back to <body>).
  useEffect(() => {
    if (open) {
      const active = document.activeElement as HTMLElement | null;
      const live = active && active !== document.body && active.isConnected;
      const opener = live && !overlay.current?.contains(active) ? active : null;
      restoreFocus.current = opener ?? siblingMenuButton(overlay.current);
    } else {
      const target = returnFocusRef?.current ?? restoreFocus.current;
      if (target?.isConnected) target.focus();
      restoreFocus.current = null;
    }
  }, [open, returnFocusRef]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Mid-deletion the request can't be recalled, so the dialog stays put
      // (Cancel is disabled for the same reason).
      if (e.key === "Escape" && !busy) {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !card.current) return;
      const focusables = card.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const outside = !card.current.contains(active);
      if (e.shiftKey && (active === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, busy]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onConfirm(password);
      // On success the account is gone; the parent unmounts this via auth state.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong — please try again.");
      setBusy(false);
    }
  };


  return (
    <div
      ref={overlay}
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-ink/45 px-4 pb-4 pt-16 min-[900px]:pt-24"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        ref={card}
        className="w-full max-w-[480px] rounded-dialog bg-ground p-5 text-ink shadow-dialog min-[900px]:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-2xl font-semibold tracking-[-0.01em] text-ink">
          Delete your account
        </h2>
        <p className="mt-2 text-muted">
          This permanently removes your email, name and per-match picks, and signs you out
          everywhere. It can&apos;t be undone. If your bracket is on the public leaderboard, the
          entry stays under <span className="font-semibold text-ink">&ldquo;Deleted user&rdquo;</span>.
          Enter your password to confirm.
        </p>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <div>
            <label htmlFor={passwordId} className="mb-1.5 block font-medium text-ink">
              Password
            </label>
            <input
              ref={firstField}
              id={passwordId}
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className={FIELD_INPUT}
            />
          </div>
          {error && (
            <p role="alert" className="text-notes font-medium text-miss">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-3 pt-2">
            {/* Cancel is the ghost; the destructive action is a miss-red pill. */}
            <GhostButton onClick={onClose} disabled={busy} className="min-h-[48px]">
              Cancel
            </GhostButton>
            <button
              type="submit"
              disabled={busy || !password}
              className="inline-flex min-h-[48px] items-center justify-center rounded-full bg-miss px-6 font-semibold text-white transition-colors hover:bg-miss/90 disabled:cursor-not-allowed disabled:bg-disabled"
            >
              {busy ? "Deleting…" : "Delete account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
