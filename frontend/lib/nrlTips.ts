/** Client for the beat-the-AI loop (design doc: NRL Round Tips, Slice 2):
 *  device_id-keyed tip submission, "you vs the AI" summary, and the weekly
 *  leaderboard (backend/app/api/nrl_user_tips.py). Anonymous by default --
 *  device_id is NOT auth, mirrors session.ts's getOrCreateDeviceId/
 *  pingDailyActivity convention. Reuses session.ts's `request` so every call
 *  gets the same cold-start timeout and {error:{code,message}} -> ApiError
 *  normalization as the rest of the app. */
import { isNrlLiveNow } from "./nrlLive";
import { request } from "./session";
import type {
  NrlMyTipsResponse,
  NrlSeasonLeaderboardResponse,
  NrlTipClaimResponse,
  NrlTipsLeaderboardResponse,
  NrlTipSubmitResponse,
  NrlTipsSummaryResponse,
} from "./types";

/** Where the NRL season stands -- the one rule /nrl, /play, /nrl/tips and the
 *  home page share:
 *  - "pre-season": next season's draw is loaded, nothing in it has started,
 *    and the first kickoff is more than two weeks away;
 *  - "open": something is live or still to kick off;
 *  - "between-rounds": nothing to tip until the next round's draw lands;
 *  - "complete": the season is over. */
export type NrlSeasonState = "pre-season" | "open" | "between-rounds" | "complete";

interface NrlMatchLike {
  status: string;
  kickoff_utc: string | null;
}
interface NrlRoundLike {
  matches: NrlMatchLike[];
}

const DAY_MS = 86_400_000;
const PRE_SEASON_LEAD_DAYS = 14;
const SEASON_OVER_AFTER_DAYS = 21;
/** Mirrors backend nrl_tips._current_round: an in_play row stops counting
 *  as current at kickoff + _MATCH_DURATION (110 min) + _LIVE_STATE_GRACE
 *  (30 min), so a final stuck "in_play" can't hold the season open. */
const IN_PLAY_OPEN_MS = 140 * 60_000;

function kickoffMs(match: NrlMatchLike): number {
  return match.kickoff_utc ? Date.parse(match.kickoff_utc) : NaN;
}

/** Live (bounded), or still to kick off. A "scheduled" row is open until
 *  kickoff, and through the live window after it (status lag); later it's a
 *  ghost, never open. */
export function isNrlOpenMatch(match: NrlMatchLike, now: Date = new Date()): boolean {
  const t = now.getTime();
  const kickoff = kickoffMs(match);
  if (match.status === "in_play") return Number.isNaN(kickoff) || t <= kickoff + IN_PLAY_OPEN_MS;
  if (match.status !== "scheduled") return false;
  if (Number.isNaN(kickoff)) return true; // kickoff time TBC
  return kickoff > t || isNrlLiveNow(match, now);
}

/** The season's first kickoff (ISO), for "starts …" copy. */
export function nrlSeasonStart(rounds: NrlRoundLike[]): string | null {
  let first: string | null = null;
  for (const match of rounds.flatMap((r) => r.matches)) {
    if (match.kickoff_utc && (first == null || Date.parse(match.kickoff_utc) < Date.parse(first))) {
      first = match.kickoff_utc;
    }
  }
  return first;
}

/** `rounds` is the season's draw (/api/nrl/matches) or just the current
 *  round (the tipsheet: `[{ matches }]`). Nothing left to tip after a single
 *  decided final -- the last round's only match, the Grand Final -- or weeks
 *  after the last kickoff is a finished season; anything else is the gap
 *  between two rounds, so the days before the finals draw never read as
 *  "season complete". */
export function nrlSeasonState(rounds: NrlRoundLike[], now: Date = new Date()): NrlSeasonState {
  const t = now.getTime();
  const matches = rounds.flatMap((r) => r.matches);
  const kickoffs = matches.map(kickoffMs).filter((k) => !Number.isNaN(k));
  const started = matches.some((m) => {
    const kickoff = kickoffMs(m);
    return m.status === "finished" || m.status === "in_play" || (!Number.isNaN(kickoff) && kickoff <= t);
  });
  if (!started && kickoffs.length > 0 && Math.min(...kickoffs) - t > PRE_SEASON_LEAD_DAYS * DAY_MS) {
    return "pre-season";
  }
  if (matches.some((m) => isNrlOpenMatch(m, now))) return "open";
  const last = rounds[rounds.length - 1];
  const decidedFinal = last?.matches.length === 1 && last.matches[0].status === "finished";
  const longOver = kickoffs.length > 0 && t - Math.max(...kickoffs) > SEASON_OVER_AFTER_DAYS * DAY_MS;
  return decidedFinal || longOver ? "complete" : "between-rounds";
}

/** "Thursday 4 March" / "Thu 4 Mar" for an NRL date, in Sydney time (the
 *  date the NRL itself publishes). */
export function nrlStartLabel(iso: string, style: "long" | "short" = "long"): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    weekday: style,
    day: "numeric",
    month: style,
  })
    .format(new Date(iso))
    .replace(",", "");
}

/** Calendar fallback for surfaces without fixture data (a failed fetch):
 *  the NRL runs from early March to the Grand Final in the first week of
 *  October, so 8 October through February is the off-season. */
export function isNrlOffSeasonDate(now: Date = new Date()): boolean {
  const month = now.getMonth(); // 0 = January
  return month >= 10 || (month === 9 && now.getDate() >= 8) || month <= 1;
}

/** The year the NRL is next back, for "back March {year}" copy. */
export function nrlReturnYear(now: Date = new Date()): number {
  return now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
}

export const submitNrlTip = (body: {
  device_id: string;
  match_id: number;
  pick: "home" | "draw" | "away";
  margin?: number | null;
}) =>
  request<NrlTipSubmitResponse>("/api/nrl/tips/submit", {
    method: "POST",
    body: JSON.stringify(body),
  });

/** season/round default to the current round server-side, same as
 *  getNrlTipsheetServer -- callers pass both explicitly so this can never
 *  disagree with the tipsheet round already on the page. */
export const getMyNrlTips = (device_id: string, season: number, round: number) =>
  request<NrlMyTipsResponse>(
    `/api/nrl/tips/mine?${new URLSearchParams({
      device_id,
      season: String(season),
      round: String(round),
    })}`,
  );

export const getNrlTipsSummary = (device_id: string) =>
  request<NrlTipsSummaryResponse>(`/api/nrl/tips/summary?device_id=${encodeURIComponent(device_id)}`);

export const getNrlTipsLeaderboard = (season: number, round: number) =>
  request<NrlTipsLeaderboardResponse>(`/api/nrl/tips/leaderboard?season=${season}&round=${round}`);

/** Season-long leaderboard (Slice 2.5) -- same below-gate reveal rule as the
 *  weekly board, just totaled across the whole season instead of one round. */
export const getNrlSeasonLeaderboard = (season: number) =>
  request<NrlSeasonLeaderboardResponse>(`/api/nrl/tips/leaderboard/season?season=${season}`);

/** Merge-on-signup: idempotent server-side, safe to call on every sign-in. */
export const claimNrlTips = (device_id: string) =>
  request<NrlTipClaimResponse>("/api/nrl/tips/claim", {
    method: "POST",
    body: JSON.stringify({ device_id }),
  });
