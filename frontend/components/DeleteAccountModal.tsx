"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "@/lib/session";

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

  const field =
    "w-full rounded-lg border border-border bg-surface/60 px-3 py-2 text-sm outline-none focus:border-loss/50 focus:ring-2 focus:ring-loss/20";

  return (
    <div
      ref={overlay}
      className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div ref={card} className="glass w-full max-w-sm rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <h2 id={titleId} className="font-display text-lg font-extrabold tracking-tight text-loss-ink">
          Delete your account
        </h2>
        <p className="mt-2 text-sm text-muted">
          This permanently removes your email, name and per-match picks, and signs you out
          everywhere. It can&apos;t be undone. If your bracket is on the public leaderboard, the
          entry stays under <span className="font-semibold text-foreground">&ldquo;Deleted user&rdquo;</span>.
          Enter your password to confirm.
        </p>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div>
            <label htmlFor={passwordId} className="mb-1 block text-xs font-semibold text-muted">
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
              className={field}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm font-medium text-loss-ink">
              {error}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-muted transition hover:bg-surface-2/60 hover:text-foreground disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !password}
              className="flex-1 rounded-lg bg-loss/15 px-3 py-2 text-sm font-bold text-loss-wash-ink ring-1 ring-loss/30 transition hover:bg-loss/25 disabled:opacity-60"
            >
              {busy ? "Deleting…" : "Delete account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
