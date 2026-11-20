"use client";

import { useState } from "react";
import { resendVerification, friendlyAuthError, type SessionUser } from "@/lib/session";

/** A gentle prompt for signed-in users whose email isn't confirmed yet. Shown
 *  ONLY when email_verified is explicitly false — `undefined` (a pre-field cached
 *  hint, before /me reconciles) is treated as unknown so a verified user never
 *  sees a flash of "verify your email". Verification is non-blocking. */
export function VerifyEmailBanner({ user }: { user: SessionUser | null }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  if (!user || user.email_verified !== false) return null;

  const resend = async () => {
    setState("sending");
    setMsg(null);
    try {
      await resendVerification();
      setState("sent");
    } catch (e) {
      setState("error");
      setMsg(friendlyAuthError(e));
    }
  };

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-line bg-soft px-4 py-2 text-center text-notes text-ink"
    >
      <span className="font-medium">Verify your email to secure your account.</span>
      {state === "sent" ? (
        <span className="font-semibold text-brand">Sent — check your inbox.</span>
      ) : state === "error" ? (
        <span className="font-medium text-miss">{msg}</span>
      ) : (
        <button
          type="button"
          onClick={resend}
          disabled={state === "sending"}
          className="min-h-[44px] font-semibold text-brand underline-offset-[3px] hover:underline disabled:text-muted"
        >
          {state === "sending" ? "Sending…" : "Resend email"}
        </button>
      )}
    </div>
  );
}
