"use client";

import { useId, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { resetPassword, friendlyAuthError } from "@/lib/session";

/** Consumes the ?token= from a reset email and sets a new password. Display-only
 *  states: missing token, the form, success, and a friendly error (e.g. an
 *  expired/used link) with a route back to request a fresh one. */
export function ResetPasswordClient() {
  const token = useSearchParams().get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const uid = useId();
  const passwordId = `${uid}-password`;
  const passwordHintId = `${uid}-password-hint`;
  const confirmId = `${uid}-confirm`;

  const field =
    "w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-win";
  const labelCls = "mb-1 block text-xs font-semibold text-muted";

  if (!token) {
    return (
      <Shell title="Reset link invalid">
        <p className="text-sm text-muted">
          This reset link is missing or incomplete. Open the most recent email, or
          request a new link from the sign-in screen.
        </p>
        <Home />
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell title="Password updated">
        <p className="text-sm text-foreground">
          Your password has been updated. You can sign in with it now.
        </p>
        <Home label="Back to FinalWhistle" />
      </Shell>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Those passwords don’t match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Choose a new password">
      <form onSubmit={submit} className="space-y-3">
        {/* Visible labels: a placeholder-only field loses its name on the
            first keystroke. */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={passwordId} className={labelCls}>
              New password
            </label>
            <span id={passwordHintId} className="text-xs text-muted">
              8+ characters
            </span>
          </div>
          <div className="relative">
            <input
              id={passwordId}
              type={show ? "text" : "password"}
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby={passwordHintId}
              className={`${field} pr-11`}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Hide password" : "Show password"}
              aria-pressed={show}
              className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-muted transition hover:text-foreground"
            >
              {show ? (
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 3l18 18" />
                <path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
                <path d="M9.9 5.2A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.9 3.7M6.2 6.2A17.5 17.5 0 0 0 2 12s3.5 7 10 7a10.4 10.4 0 0 0 3.4-.6" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
            </button>
          </div>
        </div>
        <div>
          <label htmlFor={confirmId} className={labelCls}>
            Confirm new password
          </label>
          <input
            id={confirmId}
            type={show ? "text" : "password"}
            required
            minLength={8}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={field}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-loss-ink">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-win px-4 py-3 text-sm font-bold text-pitch transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "Please wait…" : "Update password"}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <div className="glass rounded-2xl p-6">
        <h1 className="mb-4 font-display text-xl font-extrabold tracking-tight">{title}</h1>
        <div className="space-y-4">{children}</div>
      </div>
    </div>
  );
}

function Home({ label = "Back to home" }: { label?: string }) {
  return (
    <Link
      href="/"
      className="block text-center text-sm font-semibold text-lime-deep underline-offset-2 hover:underline"
    >
      {label}
    </Link>
  );
}
