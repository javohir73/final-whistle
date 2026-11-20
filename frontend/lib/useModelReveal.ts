"use client";

/** Client hooks for the reveal rule (lib/reveal.ts): find the viewer's LOCKED
 *  pick for a fixture, wherever its competition keeps it, and answer "may I
 *  show the model's call here, now?".
 *
 *  - Club leagues: GET /api/leagues/{league}/tips/mine (device id), one
 *    request per (league, matchweek) shared by every hook on the page, plus
 *    the device's confirmed-pick cache (`finalwhistle:league-tips:v1:...`)
 *    so a repeat visit reveals without waiting on the network.
 *  - NRL: GET /api/nrl/tips/mine per (season, round) + its cache.
 *  - World Cup archive: the local W/D/L store (lib/useMatchPicks).
 *
 *  Hydration-safe: the server render and the first client pass decide by the
 *  fixture's status alone (pick state unknown = hidden), so an open fixture
 *  is always hidden in HTML and never flashes the model's numbers. Nothing
 *  here submits, scores or adds an endpoint. */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getMyLeagueTips } from "@/lib/leagueTips";
import { getMyNrlTips } from "@/lib/nrlTips";
import { ApiError, getOrCreateDeviceId } from "@/lib/session";
import { useMatchPicks } from "@/lib/useMatchPicks";
import { pickGameFor, revealDecision, type RevealReason } from "@/lib/reveal";
import { useHydratedNow } from "@/components/match/clock";
import {
  cachedPrediction,
  readMatchweekHint,
  writePickerCache,
} from "@/components/match/leagueTipLookup";
import {
  LEAGUE_TIPS_CACHE_PREFIX,
  NRL_TIPS_CACHE_PREFIX,
  TIPS_IDENTITY_EVENT,
} from "@/components/play/tipsIdentity";
import type { CompetitionId } from "@/lib/sports";
import type { LeagueTipsMineResponse, NrlMyTipsResponse } from "@/lib/types";

// ---------------------------------------------------------------- types

/** What a screen passes in. Field names match MatchSummary / Prediction. */
export interface RevealFixture {
  competition: CompetitionId | string;
  matchId: number;
  status: string | null | undefined;
  kickoffUtc: string | null | undefined;
  /** Club leagues: the match's matchweek (Prediction/MatchSummary carry it).
   *  undefined: looked up from this device's cache, else the server's
   *  current matchweek. null: no league matchweek (cannot be picked). */
  matchweek?: number | null;
  /** NRL: the round the fixture belongs to (the tipsheet's season/round). */
  season?: number;
  round?: number;
}

/** The viewer's locked pick, normalised across games. */
export type RevealPick =
  | {
      kind: "score";
      home: number;
      away: number;
      /** Graded points (5 exact, 2 right result, 0), null until graded. */
      points: number | null;
      exact: boolean | null;
      gradedAt: string | null;
    }
  | {
      kind: "outcome";
      pick: "home" | "draw" | "away";
      /** NRL featured-match margin, else null. */
      margin: number | null;
      /** NRL: 1 per correct winner once graded; World Cup: never scored. */
      points: number | null;
    };

export interface ModelReveal {
  /** Show the model's score, chances, confidence, reasons, goal chances. */
  revealed: boolean;
  reason: RevealReason;
  /** The viewer's locked pick, when known (also on finished fixtures). */
  pick: RevealPick | null;
  /** The pick state is still being read. `revealed` is false meanwhile for
   *  an open fixture -- render the hidden state, not a spinner over numbers. */
  isLoading: boolean;
}

export interface RevealOptions {
  /** The page's clock. Pass MatchLiveProvider's `now` on the match page.
   *  Omitted: the browser clock (null while hydrating, unless serverNow). */
  now?: Date | null;
  /** The server render instant (ISO) for the first client pass. */
  serverNow?: string | null;
  /** "public" for embeds / share cards: a pick never unlocks an open fixture
   *  and no pick is fetched. */
  viewer?: "picker" | "public";
}

// ---------------------------------------------------------------- shared store

type Loaded<T> = { state: "loading"; promise: Promise<void> } | { state: "done"; data: T | null } | { state: "error" };

const leagueWeeks = new Map<string, Loaded<LeagueTipsMineResponse>>();
const nrlRounds = new Map<string, Loaded<NrlMyTipsResponse>>();
/** Picks locked in this tab (announceLockedPick), keyed `${competition}:${matchId}`. */
const announced = new Map<string, RevealPick>();
const listeners = new Set<() => void>();
let version = 0;
let windowListening = false;

function emit(): void {
  version += 1;
  listeners.forEach((l) => l());
}

function onIdentityChanged(): void {
  // A sign-in claim can move this device's picks to an account: forget what
  // was read and ask the server again.
  leagueWeeks.clear();
  nrlRounds.clear();
  announced.clear();
  emit();
}

function onStorage(e: StorageEvent): void {
  if (e.key == null || e.key.startsWith(LEAGUE_TIPS_CACHE_PREFIX) || e.key.startsWith(NRL_TIPS_CACHE_PREFIX)) emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!windowListening && typeof window !== "undefined") {
    windowListening = true;
    window.addEventListener(TIPS_IDENTITY_EVENT, onIdentityChanged);
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && windowListening) {
      windowListening = false;
      window.removeEventListener(TIPS_IDENTITY_EVENT, onIdentityChanged);
      window.removeEventListener("storage", onStorage);
    }
  };
}

const getVersion = () => version;
const getServerVersion = () => 0;

/** Re-render when anything in the store changes. */
function useStoreVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getServerVersion);
}

const NOT_THERE = new Set(["matchweek_not_found", "league_not_found", "league_inactive", "no_matchweek_data", "round_not_found"]);

function load<T>(map: Map<string, Loaded<T>>, key: string, fetcher: () => Promise<T>): void {
  if (map.has(key)) return;
  const promise = Promise.resolve()
    .then(fetcher)
    .then((data) => {
      map.set(key, { state: "done", data });
    })
    .catch((err) => {
      // "Nothing there" is an answer (no pick), anything else is an error.
      map.set(key, err instanceof ApiError && NOT_THERE.has(err.code) ? { state: "done", data: null } : { state: "error" });
    })
    .finally(emit);
  map.set(key, { state: "loading", promise });
}

const leagueKey = (device: string, league: string, week: number | "current") => `${device}|${league}|${week}`;
const nrlKey = (device: string, season: number, round: number) => `${device}|${season}|${round}`;

/** Tell every reveal hook on the page that this device just locked a pick
 *  (call it right after a server-ACCEPTED submit, with the server's values).
 *  Club leagues also get the shared confirmed-pick cache written, the same
 *  write /play and the match page make, so a reload reveals instantly. */
export function announceLockedPick(input: {
  competition: CompetitionId | string;
  matchId: number;
  matchweek?: number | null;
  pick: RevealPick;
}): void {
  const { competition, matchId, matchweek, pick } = input;
  announced.set(`${competition}:${matchId}`, pick);
  if (pick.kind === "score" && pickGameFor(competition) === "league_tips" && typeof matchweek === "number") {
    writePickerCache(competition, matchweek, matchId, { predicted_home: pick.home, predicted_away: pick.away });
  }
  emit();
}

/** Test helper: forget everything the store has read or been told. */
export function resetRevealStore(): void {
  leagueWeeks.clear();
  nrlRounds.clear();
  announced.clear();
  emit();
}

// ---------------------------------------------------------------- pick lookup

interface PickLookup {
  pick: RevealPick | null;
  /** Still reading: the answer may yet become "locked". */
  loading: boolean;
}

/** Club leagues: which week to read for a fixture. */
function leagueWeekFor(f: RevealFixture): number | "current" | null {
  if (f.matchweek === null) return null;
  if (typeof f.matchweek === "number" && Number.isInteger(f.matchweek) && f.matchweek >= 1) return f.matchweek;
  return readMatchweekHint(String(f.competition), f.matchId) ?? "current";
}

function lookupLeague(device: string, f: RevealFixture): PickLookup {
  const league = String(f.competition);
  const week = leagueWeekFor(f);
  if (week === null) return { pick: null, loading: false };
  // The confirmed-pick cache is only written after a server-accepted submit,
  // so it can reveal before the network answers.
  if (week !== "current") {
    const c = cachedPrediction(league, week, f.matchId);
    if (c) {
      const entry = leagueWeeks.get(leagueKey(device, league, week));
      const row = entry?.state === "done" ? entry.data?.matches.find((m) => m.id === f.matchId) : undefined;
      const y = row?.your_prediction;
      return {
        pick: y
          ? { kind: "score", home: y.predicted_home, away: y.predicted_away, points: y.points, exact: y.exact, gradedAt: y.graded_at }
          : { kind: "score", home: c.predicted_home, away: c.predicted_away, points: null, exact: null, gradedAt: null },
        loading: false,
      };
    }
  }
  const entry = leagueWeeks.get(leagueKey(device, league, week));
  if (!entry || entry.state === "loading") return { pick: null, loading: true };
  if (entry.state === "error") return { pick: null, loading: false };
  const y = entry.data?.matches.find((m) => m.id === f.matchId)?.your_prediction;
  return {
    pick: y
      ? { kind: "score", home: y.predicted_home, away: y.predicted_away, points: y.points, exact: y.exact, gradedAt: y.graded_at }
      : null,
    loading: false,
  };
}

function readNrlCache(season: number, round: number, matchId: number): { pick: "home" | "draw" | "away"; margin: number | null } | null {
  try {
    const raw = window.localStorage.getItem(`${NRL_TIPS_CACHE_PREFIX}${season}:${round}`);
    const all = raw ? (JSON.parse(raw) as Record<number, { pick: "home" | "draw" | "away"; margin: number | null }>) : null;
    return all?.[matchId] ?? null;
  } catch {
    return null;
  }
}

function lookupNrl(device: string, f: RevealFixture): PickLookup {
  if (f.season == null || f.round == null) return { pick: null, loading: false };
  const entry = nrlRounds.get(nrlKey(device, f.season, f.round));
  const tip = entry?.state === "done" ? entry.data?.matches.find((m) => m.id === f.matchId)?.your_tip : null;
  if (tip) return { pick: { kind: "outcome", pick: tip.pick, margin: tip.margin, points: tip.points }, loading: false };
  const c = readNrlCache(f.season, f.round, f.matchId);
  if (c) return { pick: { kind: "outcome", pick: c.pick, margin: c.margin, points: null }, loading: false };
  if (!entry || entry.state === "loading") return { pick: null, loading: true };
  return { pick: null, loading: false };
}

// ---------------------------------------------------------------- hooks

/** The device id, after mount only (undefined before; null when storage is
 *  blocked, in which case nobody can have picked on this device). */
function useDeviceId(enabled: boolean): string | null | undefined {
  const [device, setDevice] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (enabled) setDevice(getOrCreateDeviceId());
  }, [enabled]);
  return device;
}

/** The batched form: one read per (league, matchweek) / (season, round) for
 *  a whole list of fixtures. `get(matchId)` answers for any fixture passed
 *  in (an unknown id answers hidden). */
export function useModelRevealMap(
  fixtures: readonly RevealFixture[],
  options: RevealOptions = {},
): { get: (matchId: number) => ModelReveal; isLoading: boolean } {
  const viewer = options.viewer ?? "picker";
  const hydratedNow = useHydratedNow(options.serverNow);
  const now = options.now !== undefined ? options.now : hydratedNow;
  const storeVersion = useStoreVersion();
  const { picks: wcPicks, hydrated: wcHydrated } = useMatchPicks();

  const needsPicks = viewer === "picker" && fixtures.some((f) => pickGameFor(f.competition) != null);
  const device = useDeviceId(needsPicks);

  // Which reads this list needs, as stable keys.
  const reads = useMemo(() => {
    if (!device) return { league: [] as [string, string, number | "current"][], nrl: [] as [string, number, number][] };
    const league = new Map<string, [string, string, number | "current"]>();
    const nrl = new Map<string, [string, number, number]>();
    for (const f of fixtures) {
      const game = pickGameFor(f.competition);
      if (game === "league_tips") {
        const week = leagueWeekFor(f);
        if (week !== null) league.set(leagueKey(device, String(f.competition), week), [device, String(f.competition), week]);
      } else if (game === "nrl_tips" && f.season != null && f.round != null) {
        nrl.set(nrlKey(device, f.season, f.round), [device, f.season, f.round]);
      }
    }
    return { league: [...league.values()], nrl: [...nrl.values()] };
    // storeVersion: re-plan after an identity reset or a cache change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device, fixtures, storeVersion]);

  useEffect(() => {
    for (const [d, league, week] of reads.league) {
      load(leagueWeeks, leagueKey(d, league, week), () =>
        getMyLeagueTips(league, d, week === "current" ? undefined : week),
      );
    }
    for (const [d, season, round] of reads.nrl) {
      load(nrlRounds, nrlKey(d, season, round), () => getMyNrlTips(d, season, round));
    }
  }, [reads]);

  return useMemo(() => {
    const byId = new Map<number, ModelReveal>();
    let anyLoading = false;
    for (const f of fixtures) {
      const game = pickGameFor(f.competition);
      let lookup: PickLookup = { pick: null, loading: false };
      if (viewer === "picker" && game) {
        const mine = announced.get(`${f.competition}:${f.matchId}`);
        if (mine) lookup = { pick: mine, loading: false };
        else if (device === undefined) lookup = { pick: null, loading: true };
        else if (device === null) lookup = { pick: null, loading: false };
        else if (game === "league_tips") lookup = lookupLeague(device, f);
        else if (game === "nrl_tips") lookup = lookupNrl(device, f);
        else if (game === "wc_outcome") {
          const p = wcPicks[f.matchId];
          lookup = !wcHydrated
            ? { pick: null, loading: true }
            : { pick: p ? { kind: "outcome", pick: p, margin: null, points: null } : null, loading: false };
        }
      }
      const decision = revealDecision({
        status: f.status,
        kickoff: f.kickoffUtc,
        now,
        hasLockedPick: lookup.pick != null,
        pickGame: game != null,
        viewer,
      });
      // Loading only matters while it could still change the answer.
      const isLoading = lookup.loading && !decision.revealed;
      if (isLoading) anyLoading = true;
      byId.set(f.matchId, { ...decision, pick: lookup.pick, isLoading });
    }
    const hidden: ModelReveal = { revealed: false, reason: "hidden", pick: null, isLoading: false };
    return { get: (matchId: number) => byId.get(matchId) ?? hidden, isLoading: anyLoading };
    // storeVersion: the store is module state; re-derive when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtures, device, now, viewer, wcPicks, wcHydrated, storeVersion]);
}

/** One fixture. Same answer as the batched form (and shares its reads, so a
 *  match page with several gated sections still makes one request). */
export function useModelReveal(fixture: RevealFixture, options: RevealOptions = {}): ModelReveal {
  const { competition, matchId, status, kickoffUtc, matchweek, season, round } = fixture;
  const list = useMemo(
    () => [{ competition, matchId, status, kickoffUtc, matchweek, season, round }],
    [competition, matchId, status, kickoffUtc, matchweek, season, round],
  );
  return useModelRevealMap(list, options).get(matchId);
}
