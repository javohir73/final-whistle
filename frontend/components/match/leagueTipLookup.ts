/** Finding one match's row in the league scoreline-tips game.
 *
 *  /tips/mine is matchweek-scoped. The match summary and prediction payloads
 *  carry the match's `matchweek`, so the lookup is one request for that week
 *  (and none at all for a match with no league matchweek). Only when the field
 *  is absent -- an older backend -- does it fall back to finding the week:
 *  a remembered week (this page's own hint, or the /play picker's cache,
 *  which is keyed by week), then the server's current week, then a short walk
 *  guided by kickoff dates, never more than `maxRequests`.
 *
 *  Replicates the minimal contract of components/leagueTips/LeagueTipsPicker
 *  (same device id, same cache format) without importing it, so a pick made
 *  here shows up instantly in /play and vice versa. */
import { getMyLeagueTips } from "@/lib/leagueTips";
import { ApiError } from "@/lib/session";
import type { LeagueTipsMineMatch, LeagueTipsMineResponse } from "@/lib/types";
import { LEAGUE_TIPS_CACHE_PREFIX } from "@/components/play/tipsIdentity";

/** The /play picker's per-(league, matchweek) cache of CONFIRMED predictions,
 *  `${prefix}${league}:${matchweek}` -> { [matchId]: { predicted_home, predicted_away } }.
 *  The prefix is owned by tipsIdentity, which clears these after a sign-in
 *  claim. */
const PICKER_CACHE_PREFIX = LEAGUE_TIPS_CACHE_PREFIX;
/** This page's own memo of which matchweek a match id lives in. */
const MATCHWEEK_HINTS_PREFIX = "finalwhistle:league-tips:matchweek:v1:";
const WEEK_MS = 7 * 24 * 60 * 60_000;

export interface CachedPrediction {
  predicted_home: number;
  predicted_away: number;
}

export interface FoundTip {
  /** The matchweek the match was found in, or null when it was not found. */
  matchweek: number | null;
  /** This device's row for the match (model reveal, its prediction, grading). */
  row: LeagueTipsMineMatch | null;
  /** The device's tip_players handle, once it has played anything. */
  handle: string | null;
}

export interface LookupHints {
  /** The match's matchweek from the summary / prediction payload. A number
   *  goes straight to that week; null means the match has no league matchweek
   *  (nothing to look up); undefined -- an older backend omits the field --
   *  falls back to the walk. */
  matchweek?: number | null;
  /** Kickoff (UTC ISO), which guides the fallback walk. */
  kickoffUtc?: string | null;
  /** Request budget for the fallback walk. */
  maxRequests?: number;
}

/** The league has no tips data at all (unknown code, not loaded, no weeks). */
export class LeagueTipsNotOpen extends Error {}
const NOT_OPEN_CODES = new Set(["league_not_found", "league_inactive", "no_matchweek_data"]);

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null; // storage unavailable or corrupt -- non-fatal
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode / quota) -- non-fatal */
  }
}

export function cachedPrediction(league: string, matchweek: number, matchId: number): CachedPrediction | null {
  if (typeof window === "undefined") return null;
  return readJson<Record<number, CachedPrediction>>(`${PICKER_CACHE_PREFIX}${league}:${matchweek}`)?.[matchId] ?? null;
}

/** Same write the /play picker makes after a server-accepted submit. */
export function writePickerCache(league: string, matchweek: number, matchId: number, pred: CachedPrediction): void {
  if (typeof window === "undefined") return;
  const key = `${PICKER_CACHE_PREFIX}${league}:${matchweek}`;
  writeJson(key, { ...(readJson<Record<number, CachedPrediction>>(key) ?? {}), [matchId]: pred });
}

export function rememberMatchweek(league: string, matchId: number, matchweek: number): void {
  if (typeof window === "undefined") return;
  const key = `${MATCHWEEK_HINTS_PREFIX}${league}`;
  writeJson(key, { ...(readJson<Record<number, number>>(key) ?? {}), [matchId]: matchweek });
}

/** A remembered matchweek for this match: this page's memo first, then any
 *  /play picker cache entry that holds the match. */
export function readMatchweekHint(league: string, matchId: number): number | null {
  if (typeof window === "undefined") return null;
  const memo = readJson<Record<number, number>>(`${MATCHWEEK_HINTS_PREFIX}${league}`)?.[matchId];
  if (typeof memo === "number" && Number.isInteger(memo) && memo >= 1) return memo;
  try {
    const prefix = `${PICKER_CACHE_PREFIX}${league}:`;
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const week = Number(key.slice(prefix.length));
      if (!Number.isInteger(week) || week < 1) continue;
      if (readJson<Record<number, unknown>>(key)?.[matchId]) return week;
    }
  } catch {
    /* storage unavailable -- no hint */
  }
  return null;
}

/** Which matchweek to try next, judged by where this week's kickoffs sit
 *  relative to the match's kickoff; null when there is nowhere sensible left
 *  (the match falls inside this week's dates but is not listed, e.g. a
 *  rescheduled fixture, or the week has no dated fixtures). */
function nextMatchweek(week: LeagueTipsMineResponse, targetMs: number, visited: Set<number>): number | null {
  const kickoffs = week.matches
    .map((m) => (m.kickoff_utc ? Date.parse(m.kickoff_utc) : NaN))
    .filter(Number.isFinite);
  if (kickoffs.length === 0) return null;
  const first = Math.min(...kickoffs);
  const last = Math.max(...kickoffs);
  let step: number;
  if (targetMs < first) step = -Math.max(1, Math.round((first - targetMs) / WEEK_MS));
  else if (targetMs > last) step = Math.max(1, Math.round((targetMs - last) / WEEK_MS));
  else return null;
  let next = Math.max(1, week.matchweek + step);
  const direction = Math.sign(step);
  while (visited.has(next)) {
    next += direction;
    if (next < 1) return null;
  }
  return next;
}

export async function findMyLeagueTip(
  league: string,
  deviceId: string,
  matchId: number,
  { matchweek, kickoffUtc, maxRequests = 5 }: LookupHints = {},
): Promise<FoundTip> {
  const visited = new Set<number>();
  let requests = 0;
  let handle: string | null = null;

  const fetchWeek = async (matchweek?: number): Promise<LeagueTipsMineResponse | null> => {
    requests += 1;
    try {
      const res = await getMyLeagueTips(league, deviceId, matchweek);
      visited.add(res.matchweek);
      handle = res.handle ?? handle;
      return res;
    } catch (err) {
      if (err instanceof ApiError && err.code === "matchweek_not_found") {
        if (matchweek != null) visited.add(matchweek);
        return null;
      }
      if (err instanceof ApiError && NOT_OPEN_CODES.has(err.code)) throw new LeagueTipsNotOpen(err.code);
      throw err;
    }
  };
  const found = (week: LeagueTipsMineResponse | null): FoundTip | null => {
    const row = week?.matches.find((m) => m.id === matchId) ?? null;
    if (!week || !row) return null;
    rememberMatchweek(league, matchId, week.matchweek);
    return { matchweek: week.matchweek, row, handle };
  };

  // The payload knows the week: one request, no walking. A week that turns
  // out not to list the match is a data mismatch, not a reason to crawl. (A
  // value that is not a real matchweek number is read as absent.)
  if (matchweek === null) return { matchweek: null, row: null, handle };
  if (typeof matchweek === "number" && Number.isInteger(matchweek) && matchweek >= 1) {
    return found(await fetchWeek(matchweek)) ?? { matchweek: null, row: null, handle };
  }

  // Older backends: find the week.
  const hint = readMatchweekHint(league, matchId);
  let week = hint != null ? await fetchWeek(hint) : null;
  const fromHint = found(week);
  if (fromHint) return fromHint;

  if (!week) week = await fetchWeek(); // the server's current matchweek
  const target = kickoffUtc ? Date.parse(kickoffUtc) : NaN;
  while (week) {
    const hit = found(week);
    if (hit) return hit;
    if (requests >= maxRequests || !Number.isFinite(target)) break;
    const next = nextMatchweek(week, target, visited);
    if (next == null) break;
    week = await fetchWeek(next);
  }
  return { matchweek: null, row: null, handle };
}
