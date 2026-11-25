/** Payload types for the public UFC API (`/api/ufc/...`), mirroring the backend
 *  responses. Datetimes are ISO 8601 strings. "bout" and "event" are the data
 *  words; pages say "fight" and "card". */

export type UfcBoutStatus = "scheduled" | "live" | "finished" | "cancelled";
export type UfcEventStatus = "scheduled" | "live" | "finished" | "cancelled";
export type UfcMethod = "ko_tko" | "submission" | "decision" | "dq" | "draw" | "no_contest" | "other";

export interface UfcRecord {
  wins: number;
  losses: number;
  draws: number;
  no_contests: number;
}

export interface UfcFighterMini {
  slug: string;
  name: string;
  country: string | null;
  record: UfcRecord | null;
}

export type UfcOpponent = Omit<UfcFighterMini, "record">;

export interface UfcResult {
  winner: "a" | "b" | null;
  method: UfcMethod | null;
  method_detail: string | null;
  end_round: number | null;
  end_clock: string | null;
}

export type UfcPickMethod = "ko_tko" | "submission" | "decision";

/** The model's call on a fight. Absent (null) is normal, never an error. */
export interface UfcModelCall {
  model_version: string;
  winner: "a" | "b" | null;
  p_a: number;
  p_b: number;
  method: UfcPickMethod | null;
  method_probs: Record<UfcPickMethod, number> | null;
  reasons: string[];
}

export interface UfcBoutSummary {
  id: number;
  card_order: number | null;
  weight_class: string | null;
  scheduled_rounds: number | null;
  is_title: boolean | null;
  scheduled_utc: string | null;
  status: UfcBoutStatus;
  fighter_a: UfcFighterMini;
  fighter_b: UfcFighterMini;
  result: UfcResult | null;
  /** The model's public call; null (the usual case today) when there is none to show.
   *  Optional so an older API still type-checks. */
  model?: UfcModelCall | null;
}

export interface UfcSegment {
  key: string;
  label: string;
  scheduled_utc: string | null;
  bouts: UfcBoutSummary[];
}

export interface UfcEventSummary {
  slug: string;
  name: string;
  status: UfcEventStatus;
  first_bout_utc: string | null;
  last_bout_utc: string | null;
  venue: string | null;
  bout_count: number;
  main_event: { fighter_a: UfcFighterMini; fighter_b: UfcFighterMini } | null;
}

export interface UfcEventDetail extends UfcEventSummary {
  segments: UfcSegment[];
}

export interface UfcEventsResponse {
  events: UfcEventSummary[];
}

export interface UfcTapeSide {
  age: number | null;
  height_in: number | null;
  reach_in: number | null;
  stance: string | null;
}

export interface UfcStatLine {
  knockdowns: number | null;
  sig_strikes_landed: number | null;
  sig_strikes_attempted: number | null;
  total_strikes_landed: number | null;
  total_strikes_attempted: number | null;
  takedowns_landed: number | null;
  takedowns_attempted: number | null;
  submission_attempts: number | null;
  reversals: number | null;
  control_seconds: number | null;
}

export interface UfcBoutDetail extends UfcBoutSummary {
  event: { slug: string; name: string; first_bout_utc: string | null };
  segment: { key: string; label: string };
  tape: { a: UfcTapeSide; b: UfcTapeSide };
  stats: { a: UfcStatLine; b: UfcStatLine } | null;
  judges: { a: number[]; b: number[] } | null;
}

export interface UfcFighterBout {
  id: number;
  /** `date` is the card's first-bout ISO datetime (e.g. "2026-11-21T18:00:00Z"), not a calendar date. */
  event: { slug: string; name: string; date: string | null };
  opponent: UfcOpponent;
  outcome: "win" | "loss" | "draw" | "no_contest" | null;
  method: UfcMethod | null;
  end_round: number | null;
  end_clock: string | null;
  weight_class: string | null;
  status: UfcBoutStatus;
  scheduled_utc: string | null;
}

export interface UfcFighterDetail {
  slug: string;
  name: string;
  country: string | null;
  date_of_birth: string | null;
  age: number | null;
  height_in: number | null;
  reach_in: number | null;
  stance: string | null;
  record: UfcRecord | null;
  bouts: UfcFighterBout[];
}

// ---- Picks game (`/api/ufc/picks/...`) ----

export interface UfcPick {
  winner: "a" | "b";
  method: UfcPickMethod | null;
  created_at: string;
  state: "pending" | "graded" | "void";
  points: number | null;
  winner_correct: boolean | null;
  method_correct: boolean | null;
}

export interface UfcMyBout {
  bout_id: number;
  status: UfcBoutStatus;
  fighter_a: string;
  fighter_b: string;
  locks_at: string | null;
  picks_open: boolean;
  pick: UfcPick | null;
  model: UfcModelCall | null;
}

export interface UfcChangedPick {
  bout_id: number;
  fighter_a: string;
  fighter_b: string;
  pick: UfcPick;
  replaced_by_id: number | null;
}

export interface UfcPicksTotals {
  picked: number;
  graded: number;
  points: number;
  winner_method: number;
}

export interface UfcMyPicksResponse {
  event: { slug: string; name: string; first_bout_utc: string | null };
  handle: string | null;
  bouts: UfcMyBout[];
  changed_picks: UfcChangedPick[];
  totals: UfcPicksTotals;
  disclaimer: string;
}

export interface UfcPickSubmitResponse {
  ok: true;
  handle: string;
  bout_id: number;
  pick: UfcPick;
  model: UfcModelCall | null;
  disclaimer: string;
}

export interface UfcPicksSummaryResponse {
  handle: string | null;
  cards: (UfcPicksTotals & { slug: string; name: string; first_bout_utc: string | null })[];
  totals: UfcPicksTotals;
}

export interface UfcLeaderboardEntry {
  rank: number;
  handle: string;
  points: number;
  winner_method: number;
  graded: number;
  is_model: boolean;
}

export interface UfcLeaderboardResponse {
  scope: "card" | "year";
  event: { slug: string; name: string; first_bout_utc: string | null } | null;
  year: number | null;
  participant_count: number;
  entries: UfcLeaderboardEntry[];
}
