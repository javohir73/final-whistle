"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { verifyEmail, friendlyAuthError } from "@/lib/session";
import { useAuth } from "@/components/AuthProvider";
import { Button, PageHead } from "@/components/ui";

type State = "verifying" | "done" | "error" | "notoken";

/** Consumes the ?token= from a verification email (via POST, so a link-preview
 *  GET can't burn it), then clears the in-app banner by refreshing /me. */
export function VerifyEmailClient() {
  const token = useSearchParams().get("token");
  const { refresh } = useAuth();
  const [state, setState] = useState<State>(token ? "verifying" : "notoken");
  const [msg, setMsg] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    verifyEmail(token)
      .then(() => {
        setState("done");
        void refresh(); // clears the verify banner in this session
      })
      .catch((e) => {
        setState("error");
        setMsg(friendlyAuthError(e));
      });
  }, [token, refresh]);

  return (
    <div>
      {state === "verifying" && (
        <>
          <PageHead eyebrow="FinalWhistle" title="Verify your email" />
          <p role="status" className="text-muted">
            Verifying your email…
          </p>
        </>
      )}
      {state === "done" && (
        <>
          <PageHead eyebrow="FinalWhistle" title="Email verified" sub="You’re all set." />
          <Home />
        </>
      )}
      {state === "notoken" && (
        <>
          <PageHead
            eyebrow="FinalWhistle"
            title="Verification link invalid"
            sub="This link is missing its token. Open the most recent email, or resend from the banner once you’re signed in."
          />
          <Home />
        </>
      )}
      {state === "error" && (
        <>
          <PageHead
            eyebrow="FinalWhistle"
            title="Couldn’t verify"
            sub="The link may have expired. Sign in and resend a fresh one."
          />
          <p role="alert" className="-mt-2 mb-6 max-w-prose text-miss">
            {msg}
          </p>
          <Home />
        </>
      )}
    </div>
  );
}

function Home() {
  return <Button href="/">Back to FinalWhistle</Button>;
}
