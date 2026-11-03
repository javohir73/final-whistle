/** Client for the beat-the-AI loop (design doc: NRL Round Tips, Slice 2):
 *  device_id-keyed tip submission, "you vs the AI" summary, and the weekly
 *  leaderboard (backend/app/api/nrl_user_tips.py). Anonymous by default --
 *  device_id is NOT auth, mirrors session.ts's getOrCreateDeviceId/
 *  pingDailyActivity convention. Reuses session.ts's `request` so every call
 *  gets the same cold-start timeout and {error:{code,message}} -> ApiError
 *  normalization as the rest of the app. */
import { request } from "./session";
import type {
  NrlMyTipsResponse,
  NrlSeasonLeaderboardResponse,
  NrlTipClaimResponse,
  NrlTipsheetMatch,
  NrlTipsLeaderboardResponse,
  NrlTipSubmitResponse,
  NrlTipsSummaryResponse,
} from "./types";

/** "open": the current round still has something to tip; "between-rounds":
 *  nothing to tip until the next round's draw lands; "complete": the season
 *  is over. */
export type NrlSeasonState = "open" | "between-rounds" | "complete";

const SEASON_OVER_AFTER_DAYS = 21;

/** Calendar rule for surfaces with no fixture data to hand (the static home
 *  page): the NRL runs from early March to the Grand Final in early October,
 *  so October through February is the off-season. Pages that have the draw
 *  use nrlSeasonState instead. */
export function isNrlOffSeasonDate(now: Date = new Date()): boolean {
  const month = now.getMonth(); // 0 = January
  return month >= 9 || month <= 1;
}

/** The year the NRL is next back, for "back March {year}" copy. */
export function nrlReturnYear(now: Date = new Date()): number {
  return now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
}

/** Where the NRL season stands, from the current round's matches alone (the
 *  tipsheet resolves "current" server-side). Nothing left to tip after a
 *  single decided final (the Grand Final), or weeks after the last kickoff,
 *  is a finished season; anything else is just the gap between two rounds --
 *  the few days before the finals draw must never read as "season complete". */
export function nrlSeasonState(
  matches: Pick<NrlTipsheetMatch, "status" | "kickoff_utc">[],
  now: Date = new Date(),
): NrlSeasonState {
  const t = now.getTime();
  const open = matches.some(
    (m) =>
      m.status === "in_play" ||
      (m.status === "scheduled" && (m.kickoff_utc == null || Date.parse(m.kickoff_utc) > t)),
  );
  if (open) return "open";
  const decidedFinal = matches.length === 1 && matches[0].status === "finished";
  const kickoffs = matches
    .map((m) => (m.kickoff_utc ? Date.parse(m.kickoff_utc) : NaN))
    .filter((x) => !Number.isNaN(x));
  const longOver = kickoffs.length > 0 && t - Math.max(...kickoffs) > SEASON_OVER_AFTER_DAYS * 86_400_000;
  return decidedFinal || longOver ? "complete" : "between-rounds";
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
