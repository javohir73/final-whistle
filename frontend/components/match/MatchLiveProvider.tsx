"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import { getMatchSummary } from "@/lib/api";
import { MAX_LIVE_MINUTES } from "@/lib/liveLabel";
import type { CompetitionId } from "@/lib/sports";
import type { MatchSummary } from "@/lib/types";
import { useHydratedNow } from "@/components/match/clock";

const POLL_MS = 30_000;
// Fetch only while new data can arrive: from shortly before kickoff (so the
// page flips to LIVE on time) until well past the longest possible match. A
// tab parked on a fixture days out used to hit the API every 30 s for a
// payload that could not have changed. The clock keeps ticking outside the
// window -- kickoff locks are a wall-clock check, not an HTTP request.
const POLL_LEAD_MIN = 10;
const POLL_TAIL_MIN = MAX_LIVE_MINUTES + 30;

export function withinPollWindow(kickoffUtc: string | null | undefined, nowMs: number): boolean {
  if (!kickoffUtc) return true; // undated: cannot be bounded, keep polling
  const elapsedMin = (nowMs - Date.parse(kickoffUtc)) / 60_000;
  if (!Number.isFinite(elapsedMin)) return true;
  return elapsedMin >= -POLL_LEAD_MIN && elapsedMin <= POLL_TAIL_MIN;
}

/** Could a non-final seed already be out of date? From shortly before kickoff
 *  onwards, with NO upper bound: an ISR page (and the summary's own 30 s
 *  cache) can be hours old, so a page cached before kickoff and opened the
 *  next morning must still ask once. */
export function seedMayBeBehind(kickoffUtc: string | null | undefined, nowMs: number): boolean {
  if (!kickoffUtc) return true;
  const elapsedMin = (nowMs - Date.parse(kickoffUtc)) / 60_000;
  return !Number.isFinite(elapsedMin) || elapsedMin >= -POLL_LEAD_MIN;
}

export interface MatchLive {
  /** Latest summary: the server seed, then each successful poll. Null when
   *  the seed fetch failed and no client fetch has succeeded yet. */
  summary: MatchSummary | null;
  /** Shared ticking clock (every 30 s), so kickoff locks and stale flips
   *  happen on an open tab without a reload. While hydrating it is the
   *  server's render instant, so the first client pass matches the HTML. */
  now: Date;
  /** A client fetch is in flight and there is no summary to show yet. */
  loading: boolean;
  /** The last non-silent fetch failed and there is no summary to show. */
  error: boolean;
  /** Re-fetch now (the "Retry" behind an unavailable state). */
  refresh: () => void;
}

const MatchLiveContext = createContext<MatchLive | null>(null);

/** The football match page's one live feed: the hero and the pick read the
 *  same polled summary, so the pick locks the moment the hero shows kickoff.
 *  (Before, the scoreboard polled on its own and the pick card was seeded from
 *  a server snapshot that never refreshed -- its buttons stayed live after
 *  kickoff on an open tab.) Mirrors app/nrl/.../LiveMatchProvider.tsx. */
export function MatchLiveProvider({
  matchId,
  competition,
  kickoffUtc,
  initialSummary,
  serverNow,
  children,
}: {
  matchId: number;
  competition?: CompetitionId;
  /** The prediction's kickoff, used until a summary says otherwise. */
  kickoffUtc?: string | null;
  initialSummary?: MatchSummary | null;
  /** When the server rendered this page (ISO). The first client pass renders
   *  with it so cached HTML hydrates without a mismatch ("Locks at kickoff"
   *  on the server vs "Locked" in the browser); the browser clock follows. */
  serverNow?: string | null;
  children: ReactNode;
}) {
  const [summary, setSummary] = useState<MatchSummary | null>(initialSummary ?? null);
  const [loading, setLoading] = useState(initialSummary == null);
  const [error, setError] = useState(false);
  const clock = useHydratedNow(serverNow);
  // Only reached on a server render (or hydration) without serverNow.
  const [fallbackNow] = useState(() => new Date());
  const now = clock ?? fallbackNow;
  const sequence = useRef(0);
  const applied = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    (silent: boolean) => {
      const requestId = ++sequence.current;
      if (!silent) setLoading(true);
      Promise.resolve(getMatchSummary(matchId, competition))
        .then((data) => {
          // An older response landing after a newer one must not win.
          if (!mounted.current || requestId < applied.current) return;
          applied.current = requestId;
          setSummary(data);
          setError(false);
          setLoading(false);
        })
        .catch(() => {
          if (!mounted.current || requestId < applied.current) return;
          setLoading(false);
          // A failed poll keeps the last good summary on screen.
          if (!silent) setError(true);
        });
    },
    [matchId, competition],
  );

  const seeded = initialSummary != null;
  const seedFinished = initialSummary?.status === "finished";
  const seedKickoff = initialSummary?.kickoff_utc ?? kickoffUtc ?? null;

  // First client fetch: always when there is no seed (the server fetch
  // failed); for a seed, whenever it is not final and kickoff is near or past
  // -- however long ago, since cached HTML can be hours old. Silent: a failed
  // refresh keeps the seed on screen. A finished seed never refetches.
  useEffect(() => {
    if (!seeded) load(false);
    else if (!seedFinished && seedMayBeBehind(seedKickoff, Date.now())) load(true);
  }, [load, seeded, seedFinished, seedKickoff]);

  const finished = summary?.status === "finished";
  const kickoff = summary?.kickoff_utc ?? kickoffUtc ?? null;

  // The 30 s poll stays inside the match window (the clock itself ticks in
  // components/match/clock). A recorded result cannot change: no poll.
  useEffect(() => {
    if (finished) return;
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (withinPollWindow(kickoff, Date.now())) load(true);
    };
    const id = setInterval(tick, POLL_MS);
    // A tab coming back to the foreground catches up at once.
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [finished, kickoff, load]);

  const refresh = useCallback(() => load(false), [load]);

  const value = useMemo<MatchLive>(
    () => ({ summary, now, loading, error: error && summary == null, refresh }),
    [summary, now, loading, error, refresh],
  );
  return <MatchLiveContext.Provider value={value}>{children}</MatchLiveContext.Provider>;
}

/** The page's live feed, or null outside a MatchLiveProvider. */
export function useMatchLive(): MatchLive | null {
  return useContext(MatchLiveContext);
}
