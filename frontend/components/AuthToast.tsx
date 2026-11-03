"use client";

import { useEffect } from "react";

/** Small transient confirmation popup (e.g. after sign-up). Auto-dismisses.
 *  Parked above the mobile tab bar + home indicator (.bottom-above-tabbar):
 *  at a plain bottom-6 it sat on top of the tabs on every phone. */
export function AuthToast({
  message,
  onDone,
  ms = 3800,
}: {
  message: string | null;
  onDone: () => void;
  ms?: number;
}) {
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(onDone, ms);
    return () => clearTimeout(id);
  }, [message, onDone, ms]);

  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="glass fade-up bottom-above-tabbar fixed left-1/2 z-[120] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-foreground shadow-lg"
    >
      <span className="grid h-5 w-5 place-items-center rounded-full bg-win text-pitch" aria-hidden>
        ✓
      </span>
      {message}
    </div>
  );
}
