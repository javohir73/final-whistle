"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

/** One page-wide clock for status labels that depend on the time of day
 *  (LIVE vs Result pending, Locks vs Locked at kickoff, Today vs Tomorrow).
 *
 *  Pages are ISR now: their HTML can be hours old when it hydrates, so a
 *  component that reads `new Date()` during render prints one thing on the
 *  server and another on the hydrating client -- a React hydration failure
 *  that throws the server HTML away. These hooks make the first client pass
 *  read exactly what the server read, and let the browser clock take over one
 *  commit later. */

const TICK_MS = 30_000;
let current: Date | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function readClock(): Date {
  const t = Date.now();
  // Cached so consecutive reads return the same object (a stable snapshot);
  // refreshed when it is a tick old (or the clock moved backwards).
  if (!current || Math.abs(t - current.getTime()) >= TICK_MS) current = new Date(t);
  return current;
}

function subscribe(onTick: () => void): () => void {
  listeners.add(onTick);
  if (!timer) {
    timer = setInterval(() => {
      current = new Date();
      listeners.forEach((listener) => listener());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(onTick);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const unknownOnServer = () => null;

/** The browser clock, ticking every 30 s. Null on the server and while
 *  hydrating (React reads the server snapshot then), a Date afterwards and on
 *  every client-only render. */
export function useClock(): Date | null {
  return useSyncExternalStore(subscribe, readClock, unknownOnServer);
}

/** The clock for a subtree whose server component knows when it rendered:
 *  that instant while hydrating -- so the first client pass matches the HTML --
 *  then the browser clock. Without `serverNow`, null while hydrating. */
export function useHydratedNow(serverNow?: string | null): Date | null {
  const browser = useClock();
  if (browser) return browser;
  return serverNow ? new Date(serverNow) : null;
}

/** A list's clock, handed to the cards inside it (undefined: no list clock). */
export const RenderClockContext = createContext<Date | null | undefined>(undefined);

/** The clock a card or row should render with: its list's clock when there
 *  is one, else the browser clock. Null means "not known yet" -- classify by
 *  the feed's own status (matchPhase accepts null) and let the clock-based
 *  bounds apply on the next commit. */
export function useRenderNow(): Date | null {
  const fromList = useContext(RenderClockContext);
  const own = useClock();
  return fromList !== undefined ? fromList : own;
}
