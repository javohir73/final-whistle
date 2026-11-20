"use client";

import { useEffect } from "react";
import { captureClientError } from "@/components/SentryInit";

/**
 * Last-resort boundary for errors thrown in the root layout itself. It replaces
 * the whole document, so it ships its own minimal inline-styled markup (the app
 * stylesheet/layout is bypassed here). Rarely hit; route-level errors use error.tsx.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    // The root layout crashed, so <SentryInit/> may never have mounted;
    // captureClientError loads and initializes the SDK on demand (no DSN: no-op).
    captureClientError(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "2rem",
          textAlign: "center",
          background: "#ffffff",
          color: "#14181f",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>Something went wrong</h1>
        <p style={{ fontSize: "1rem", color: "#5b6470", maxWidth: "28rem" }}>
          The app hit an unexpected error. Please try again.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            cursor: "pointer",
            borderRadius: "999px",
            border: "none",
            background: "#0f4d3a",
            color: "#ffffff",
            fontWeight: 600,
            minHeight: "48px",
            padding: "0 24px",
            fontSize: "1rem",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
