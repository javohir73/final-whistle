/** Small presentation helpers shared across the UI. */
import type { Probabilities } from "./types";

export function pct(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

export type PctTriple = { home: number; draw: number; away: number };

/** Whole-number percentages for a W/D/L triple that always add up to exactly
 *  100. Rounding each outcome on its own (pct) can print 52 · 27 · 22 = 101 on
 *  a legend; this uses largest-remainder rounding instead: floor every value,
 *  then hand the spare points to the largest remainders (ties go home, draw,
 *  away, so the result is deterministic). A feed triple that does not quite sum
 *  to 1 is normalised first.
 *
 *  Null when the triple carries no usable information -- any value missing,
 *  non-finite or negative, or all three zero. Normalising a partial payload
 *  would invent certainty ({NaN, —, 0.3} used to print "away 100%"); callers
 *  print "—" instead. */
export function pctTriple(p: Probabilities): PctTriple | null {
  const raw = [p.home_win, p.draw, p.away_win];
  if (!raw.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0)) return null;
  const total = raw[0] + raw[1] + raw[2];
  if (total <= 0) return null;
  const scaled = raw.map((v) => (v / total) * 100);
  const whole = scaled.map((v) => Math.floor(v));
  let spare = 100 - (whole[0] + whole[1] + whole[2]);
  const byRemainder = [0, 1, 2].sort(
    (a, b) => scaled[b] - whole[b] - (scaled[a] - whole[a]) || a - b,
  );
  for (const i of byRemainder) {
    if (spare <= 0) break;
    whole[i] += 1;
    spare -= 1;
  }
  return { home: whole[0], draw: whole[1], away: whole[2] };
}

export type Outcome = "home" | "draw" | "away";

export function topOutcome(p: Probabilities): Outcome {
  const entries: [Outcome, number][] = [
    ["home", p.home_win],
    ["draw", p.draw],
    ["away", p.away_win],
  ];
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

export function formatScore(home: number | null, away: number | null): string {
  if (home == null || away == null) return "—";
  return `${home}–${away}`;
}

/** expected_margin is home-minus-away points; read it out as the favoured
 *  side ("Sharks by 4.0") instead of a signed number whose convention the
 *  reader has to know. Shared by the NRL match hero and the fixture-card
 *  margin chip. */
export function expectedMarginLabel(margin: number, home: string, away: string): string {
  if (margin === 0) return "dead level";
  return `${margin > 0 ? home : away} by ${Math.abs(margin).toFixed(1)}`;
}
