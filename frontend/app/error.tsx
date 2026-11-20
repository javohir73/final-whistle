"use client";

import { useEffect } from "react";
import { Button, GhostButton, PageHead } from "@/components/ui";
import { captureClientError } from "@/components/SentryInit";

/**
 * Route-level error boundary. If a render throws (e.g. a bad value reaching a
 * formatter), the user gets a recoverable fallback instead of a blank page.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Never swallow silently: the console for local debugging, Sentry for
    // production (a no-op without a DSN; it can't throw).
    console.error(error);
    captureClientError(error);
  }, [error]);

  return (
    <div>
      <PageHead
        title="Something went wrong"
        sub="This page hit an unexpected error. Try again, or head back to this week’s matches."
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <GhostButton href="/">Go to this week’s matches</GhostButton>
      </div>
    </div>
  );
}
