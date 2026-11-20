/** Pure helpers for the direction-G match page (no React, server-safe):
 *  the pick control's first-tap rule, the model's verdict, the "you and the
 *  model" line, and the small shapes the server hands the client. */
import { kickoffTime } from "@/lib/datetime";
import type { GoalMarkets, Prediction, PredictedScore, Probabilities } from "@/lib/types";

export const MIN_GOALS = 0;
export const MAX_GOALS = 15;

/** A score being set: null = that side has not been touched yet ("–"). */
export interface Draft {
  home: number | null;
  away: number | null;
}

export const EMPTY_DRAFT: Draft = { home: null, away: null };

/** "4:30 am": the shared `kickoffTime` ("4:30 AM") with the site's lower-case
 *  am/pm, as the matchweek rows and /play print it. The shared helper keeps
 *  its upper-case form for its other callers. */
export function kickoffTimeLower(iso: string, tz: string): string {
  return kickoffTime(iso, tz)
    .replace(/[\u202f\u00a0]/g, " ")
    .replace(/\b(AM|PM)\b/, (m) => m.toLowerCase());
}

/** One tap on a stepper. The first tap on an empty side sets it to 1 (+) or
 *  0 (−) and an empty other side to 0; after that ±1, clamped 0..15. */
export function stepDraft(draft: Draft, side: "home" | "away", dir: 1 | -1): Draft {
  const other = side === "home" ? "away" : "home";
  const current = draft[side];
  if (current == null) {
    return { ...draft, [side]: dir > 0 ? 1 : 0, [other]: draft[other] ?? 0 } as Draft;
  }
  return { ...draft, [side]: Math.max(MIN_GOALS, Math.min(MAX_GOALS, current + dir)) };
}

export function draftReady(d: Draft): d is { home: number; away: number } {
  return d.home != null && d.away != null;
}

type Outcome = 1 | 0 | -1;
export const outcomeOf = (h: number, a: number): Outcome => (h > a ? 1 : h < a ? -1 : 0);

/** "You and the model …" after a lock (the prototype's three wordings). */
export function agreementLine(you: { home: number; away: number }, model: { home: number; away: number }): string {
  if (you.home === model.home && you.away === model.away) return "You and the model picked the same score.";
  if (outcomeOf(you.home, you.away) === outcomeOf(model.home, model.away)) {
    return "You and the model agree on the result and differ on the score.";
  }
  return "You are against the model on this one.";
}

export type VerdictTone = "good" | "ok" | "miss";
export interface ScoreVerdict {
  label: "Exact score" | "Right result" | "Missed";
  points: 5 | 2 | 0;
  tone: VerdictTone;
}

/** The game's own scoring applied to a predicted score: exact 5, right
 *  result 2, else 0 (the same rule the picks are graded by). */
export function scoreVerdict(pred: { home: number; away: number }, actual: { home: number; away: number }): ScoreVerdict {
  if (pred.home === actual.home && pred.away === actual.away) return { label: "Exact score", points: 5, tone: "good" };
  if (outcomeOf(pred.home, pred.away) === outcomeOf(actual.home, actual.away)) {
    return { label: "Right result", points: 2, tone: "ok" };
  }
  return { label: "Missed", points: 0, tone: "miss" };
}

/** The graded points of a user's pick, as a verdict chip. */
export function pointsVerdict(points: number, exact: boolean | null): ScoreVerdict {
  if (exact || points >= 5) return { label: "Exact score", points: 5, tone: "good" };
  if (points > 0) return { label: "Right result", points: 2, tone: "ok" };
  return { label: "Missed", points: 0, tone: "miss" };
}

/** The model's call as the client sees it. Sent from the server only when the
 *  fixture is public (kicked off, finished, or no pick game); otherwise the
 *  client fetches it after the viewer's pick is locked. */
export interface ModelData {
  probabilities: Probabilities;
  predicted: PredictedScore;
  confidence: "High" | "Medium" | "Low" | null;
  reasons: string[];
  goalMarkets: GoalMarkets | null;
}

export function modelDataFrom(p: Pick<Prediction, "probabilities" | "predicted_score" | "confidence" | "reasons" | "goal_markets">): ModelData {
  return {
    probabilities: p.probabilities,
    predicted: p.predicted_score,
    confidence: p.confidence ?? null,
    reasons: p.reasons ?? [],
    goalMarkets: p.goal_markets ?? null,
  };
}

/** One fixture of the match's matchweek, for "Match 3 of 10" and "Next". */
export interface WeekFixture {
  id: number;
  home: string;
  away: string;
  kickoffUtc: string | null;
  status: string;
  matchweek: number | null;
}

/** A club's row in the table ("Where they stand", "3rd · 21 points"). */
export interface StandingLine {
  teamId: number;
  team: string;
  pos: number;
  won: number;
  drawn: number;
  lost: number;
  gd: number;
  points: number;
}

export interface Standing {
  home: StandingLine | null;
  away: StandingLine | null;
  /** "The table after 10 matchweeks." / "Group A." */
  note: string;
}
