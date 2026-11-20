/** NRL display helpers for the direction-G screens: finals stages, the
 *  model's call on a finished match, dates in Sydney time. Pure and SSR-safe.
 *  No fetching, no scoring -- only how already-fetched data is labelled. */
import type { NrlMatch, NrlRound } from "./types";

const SYD = "Australia/Sydney";

/** Finals stage names, in the order the NRL plays them (top-eight system). */
export const NRL_FINALS_STAGES = [
  "Finals week one",
  "Semi-finals",
  "Preliminary finals",
  "Grand Final",
] as const;

export interface NrlFinalsRound {
  stage: string;
  round: number | null;
  matches: NrlMatch[];
}

/** The finals series of a season, detected from the draw: the payload carries
 *  no finals marker, but the top-eight finals are the trailing run of rounds
 *  with four or fewer matches (4, 2, 2, 1) after a regular season of fuller
 *  rounds. Works while the finals are still being played (only the stages
 *  that exist so far come back). Empty when there is no such run. */
export function nrlFinalsRounds(rounds: NrlRound[]): NrlFinalsRound[] {
  let start = rounds.length;
  while (start > 0 && rounds[start - 1].matches.length > 0 && rounds[start - 1].matches.length <= 4) start--;
  const tail = rounds.slice(start);
  // Needs a regular season before it (a draw that is all small rounds is not
  // a finals series), and no more stages than the finals have.
  if (start === 0 || tail.length === 0 || tail.length > NRL_FINALS_STAGES.length) return [];
  return tail.map((r, i) => ({ stage: NRL_FINALS_STAGES[i], round: r.round, matches: r.matches }));
}

/** The Grand Final, once it has been played and decided. */
export function nrlGrandFinal(rounds: NrlRound[]): { match: NrlMatch; round: number | null } | null {
  const finals = nrlFinalsRounds(rounds);
  const last = finals[finals.length - 1];
  if (!last || last.stage !== "Grand Final" || last.matches.length !== 1) return null;
  const m = last.matches[0];
  if (m.status !== "finished" || m.score_home == null || m.score_away == null) return null;
  return { match: m, round: last.round };
}

/** The winner's name of a finished match (null for a draw or no score). */
export function nrlWinner(m: Pick<NrlMatch, "home" | "away" | "score_home" | "score_away">): string | null {
  if (m.score_home == null || m.score_away == null || m.score_home === m.score_away) return null;
  return m.score_home > m.score_away ? m.home : m.away;
}

export interface NrlModelCall {
  /** The side the model favoured. */
  team: string;
  /** The model's probability for that side (0..1). */
  probability: number;
  /** Whether that side won; null until the match is finished. */
  called: boolean | null;
}

/** The model's call on a match: its favoured side and probability, and on a
 *  finished match whether it was right. Null when there was no prediction or
 *  the two sides were dead level. ONLY render this for a match that is past
 *  the point of tipping (see lib/reveal.ts) -- callers decide that. */
export function nrlModelCall(m: NrlMatch): NrlModelCall | null {
  const p = m.prediction;
  if (!p || p.p_home === p.p_away) return null;
  const homeFav = p.p_home > p.p_away;
  const team = homeFav ? m.home : m.away;
  if (!team) return null;
  const finished = m.status === "finished" && m.score_home != null && m.score_away != null;
  return {
    team,
    probability: homeFav ? p.p_home : p.p_away,
    called: finished ? nrlWinner(m) === team : null,
  };
}

/** "64%" */
export function wholePct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/** "+164", "−94" (a real minus sign), "0". */
export function signedNumber(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return "0";
}

/** "1st", "2nd", "13th". */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** "4 October" (Sydney date). */
export function nrlDayMonth(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-AU", { timeZone: SYD, day: "numeric", month: "long" }).format(new Date(iso));
}

/** "4 October 2026" (Sydney date). */
export function nrlLongDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-AU", { timeZone: SYD, day: "numeric", month: "long", year: "numeric" }).format(
    new Date(iso),
  );
}

/** "Saturday 4 October" (Sydney date) -- day bands. */
export function nrlDayLabel(iso: string | null): string {
  if (!iso) return "Date to be confirmed";
  return new Intl.DateTimeFormat("en-AU", { timeZone: SYD, weekday: "long", day: "numeric", month: "long" })
    .format(new Date(iso))
    .replace(/,/g, "");
}

/** "7:30 pm" (Sydney time) -- the kick-off box. */
export function nrlTimeLabel(iso: string | null): string {
  if (!iso) return "TBC";
  return new Intl.DateTimeFormat("en-AU", { timeZone: SYD, hour: "numeric", minute: "2-digit", hour12: true })
    .format(new Date(iso))
    .replace(/ | /g, " ")
    .toLowerCase();
}

/** Group items by Sydney calendar day, keeping order. */
export function groupByNrlDay<T>(items: T[], iso: (t: T) => string | null): Array<{ day: string; items: T[] }> {
  const out: Array<{ day: string; items: T[] }> = [];
  for (const item of items) {
    const day = nrlDayLabel(iso(item));
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(item);
    else out.push({ day, items: [item] });
  }
  return out;
}

/** "Fri 7:30 pm AEST" -- a kick-off within the coming week (Sydney time). */
export function nrlKickoffLabel(iso: string | null): string {
  if (!iso) return "TBC";
  return new Date(iso).toLocaleString("en-AU", {
    weekday: "short", hour: "numeric", minute: "2-digit",
    timeZone: SYD, timeZoneName: "short",
  });
}
