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
