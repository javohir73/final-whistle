"use client";

import { useId, useState } from "react";
import { useSearchParams } from "next/navigation";
import { resetPassword, friendlyAuthError } from "@/lib/session";
import { Button, Card, FIELD_INPUT, PageHead } from "@/components/ui";

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

  const field = FIELD_INPUT;
  const labelCls = "mb-1.5 block font-medium text-ink";

  if (!token) {
    return (
      <Shell
        title="Reset link invalid"
        sub="This reset link is missing or incomplete. Open the most recent email, or request a new link from the sign-in screen."
      >
        <Home />
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell title="Password updated" sub="Your password has been updated. You can sign in with it now.">
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
    <Shell title="Choose a new password" sub="Pick something you have not used here before.">
      <Card pad as="div" className="max-w-[480px]">
      <form onSubmit={submit} className="space-y-5">
        {/* Visible labels: a placeholder-only field loses its name on the
            first keystroke. */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={passwordId} className={labelCls}>
              New password
            </label>
            <span id={passwordHintId} className="text-label text-muted">
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
              className={`${field} pr-12`}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Hide password" : "Show password"}
              aria-pressed={show}
              className="absolute inset-y-0 right-1 my-auto grid h-11 w-11 place-items-center rounded-full text-muted transition-colors hover:text-ink"
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
          <p role="alert" className="text-notes text-miss">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Please wait…" : "Update password"}
        </Button>
      </form>
      </Card>
    </Shell>
  );
}

function Shell({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div>
      <PageHead eyebrow="FinalWhistle" title={title} sub={sub} />
      {children}
    </div>
  );
}

function Home({ label = "Back to home" }: { label?: string }) {
  return <Button href="/">{label}</Button>;
}
