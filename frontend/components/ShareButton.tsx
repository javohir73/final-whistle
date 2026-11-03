"use client";

import { useEffect, useRef, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";

type ShareTarget = "native" | "copy" | "whatsapp" | "telegram";

/** Prefilled share links. WhatsApp takes one text blob; Telegram keeps the
 *  URL and the text apart so its preview card unfurls the link. */
export function whatsappShareUrl(title: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`;
}
export function telegramShareUrl(title: string, url: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`;
}

/** Share the current page (or `url`). On a touch device with the Web Share
 *  API it opens the native sheet; everywhere else -- desktop, and in-app
 *  browsers without navigator.share -- a small menu offers explicit targets:
 *  Copy link, WhatsApp and Telegram (the channel the marketing lives on).
 *  Each completed share is tracked as `share` {surface, target}; `surface`
 *  names where the button sits and defaults to the page path. */
export function ShareButton({
  title,
  label = "Share",
  url: urlProp,
  surface,
  className,
}: {
  title?: string;
  label?: string;
  /** Explicit URL to share. Defaults to the current page URL. */
  url?: string;
  /** Analytics surface, e.g. "league_tips_recap". Defaults to the path. */
  surface?: string;
  className?: string;
}) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ title: string; url: string } | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  const track = (target: ShareTarget) =>
    trackEvent("share", { surface: surface ?? window.location.pathname, target });

  const flash = (text: string) => {
    setFeedback(text);
    setTimeout(() => setFeedback(null), 2000);
  };

  // Close on an outside tap; focus the first target when the menu opens.
  useEffect(() => {
    if (!menu) return;
    firstItemRef.current?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menu]);

  const onShare = async () => {
    if (typeof window === "undefined") return;
    if (menu) {
      setMenu(null);
      return;
    }
    const url = urlProp ?? window.location.href;
    const shareTitle = title ?? document.title;
    const preferNative =
      typeof navigator.share === "function" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    if (preferNative) {
      try {
        await navigator.share({ title: shareTitle, url });
        track("native");
        flash("Shared!");
        return;
      } catch (err) {
        // Dismissing the sheet is a choice, not a failure.
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }
    setMenu({ title: shareTitle, url });
  };

  const closeMenu = () => {
    setMenu(null);
    triggerRef.current?.focus();
  };

  const copy = async () => {
    if (!menu) return;
    const { url } = menu;
    setMenu(null);
    try {
      await navigator.clipboard.writeText(url);
      track("copy");
      flash("Link copied!");
    } catch {
      /* clipboard blocked — nothing more we can do */
    }
  };

  return (
    <span ref={wrapperRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        onClick={onShare}
        aria-label="Share this page"
        aria-haspopup="menu"
        aria-expanded={menu != null}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted transition hover:text-foreground",
          className,
        )}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
          <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" strokeLinecap="round" />
        </svg>
        <span role="status" aria-live="polite">{feedback ?? label}</span>
      </button>

      {menu ? (
        <div
          role="menu"
          aria-label="Share via"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              closeMenu();
            }
          }}
          className="absolute right-0 top-full z-40 mt-1 flex min-w-[11rem] flex-col rounded-xl border border-border bg-surface p-1 text-sm shadow-lg"
        >
          <button
            ref={firstItemRef}
            type="button"
            role="menuitem"
            onClick={copy}
            className="flex min-h-[40px] items-center rounded-lg px-3 text-left font-medium hover:bg-surface-2"
          >
            Copy link
          </button>
          <a
            role="menuitem"
            href={whatsappShareUrl(menu.title, menu.url)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              track("whatsapp");
              setMenu(null);
            }}
            className="flex min-h-[40px] items-center rounded-lg px-3 font-medium hover:bg-surface-2"
          >
            WhatsApp
          </a>
          <a
            role="menuitem"
            href={telegramShareUrl(menu.title, menu.url)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              track("telegram");
              setMenu(null);
            }}
            className="flex min-h-[40px] items-center rounded-lg px-3 font-medium hover:bg-surface-2"
          >
            Telegram
          </a>
        </div>
      ) : null}
    </span>
  );
}
