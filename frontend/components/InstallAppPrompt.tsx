"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { useInstallPrompt } from "@/lib/useInstallPrompt";
import { trackEvent } from "@/lib/analytics";

/** Engagement-gated "install the app" card (PRD FR 4.4). Bottom-anchored and
 *  dismissible — never a blocking modal, never on first load, never while
 *  already installed. Android gets the native install flow; iOS gets manual
 *  Add-to-Home-Screen steps (Safari has no install event). */
export function InstallAppPrompt() {
  const { visible, platform, promptInstall, dismiss } = useInstallPrompt();

  // One "shown" event per appearance, not per re-render.
  const shownRef = useRef(false);
  useEffect(() => {
    if (visible && !shownRef.current) {
      shownRef.current = true;
      trackEvent("install_prompt_shown", { platform: platform ?? "unknown" });
    }
  }, [visible, platform]);

  if (!visible) return null;

  return (
    <div
      role="complementary"
      aria-label="Install FinalWhistle"
      // bottom-above-tabbar: clears the tab bar until lg. The old sm:bottom-6
      // dropped onto the bar at 640-1023px, where BottomNav is still shown.
      className="safe-x bottom-above-tabbar fixed inset-x-3 z-40 mx-auto max-w-md rounded-card border border-line bg-ground p-4 shadow-menu sm:inset-x-auto sm:right-6"
    >
      <div className="flex items-start gap-3">
        <Image
          src="/icon-192.png"
          alt=""
          width={40}
          height={40}
          className="shrink-0 rounded-[10px]"
        />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">Install FinalWhistle</p>
          {platform === "android" ? (
            <p className="mt-1 text-notes text-muted">
              Full-screen launch from your home screen — your picks and live
              scores, one tap away.
            </p>
          ) : (
            <p className="mt-1 text-notes text-muted">
              Tap{" "}
              <span className="font-semibold text-ink">
                Share{" "}
                {/* Decorative: the word "Share" already names the button. */}
                <svg viewBox="0 0 24 24" className="inline h-3.5 w-3.5 align-[-2px]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M12 3v12M8 7l4-4 4 4M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>{" "}
              then <span className="font-semibold text-ink">“Add to Home Screen”</span> to
              install the app.
            </p>
          )}
          {platform === "android" && (
            <button
              type="button"
              onClick={() => void promptInstall()}
              className="mt-3 inline-flex min-h-[44px] items-center rounded-full bg-brand px-5 font-semibold text-white transition hover:bg-brand-hover"
            >
              Install app
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted transition hover:text-ink"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
