/** Rounds for the matchweek home (/football/<comp>): the season list from
 *  /api/matches/upcoming cut into the pages the home pages through.
 *
 *  - Club leagues: one round per `matchweek` ("Matchweek 11").
 *  - Champions League: the league phase's `matchweek` is a matchday
 *    ("Matchday 5"); qualifying rows (no matchweek) are left out -- ninety
 *    summer qualifiers are not a "this week" page.
 *  - Knockout tournaments (the World Cup archive): the group stage split into
 *    its three matchdays, then each knockout stage; the third-place match
 *    sits with the final.
 *
 *  Pure and server-safe: no React, no window. */
import type { MatchSummary } from "@/lib/types";
import { COMPETITIONS, type CompetitionId } from "@/lib/sports";
import { clubLogoSrc } from "@/components/ClubBadge";

export interface Round {
  /** URL value (`?mw=<key>`): the matchweek number, or a stage slug. */
  key: string;
  /** The page title: "Matchweek 11", "Matchday 5", "Round of 16". */
  title: string;
  matches: MatchSummary[];
}

/** The query parameter the home reads and writes. */
export const ROUND_PARAM = "mw";

const KNOCKOUT_STAGES: Array<{ key: string; title: string; stages: string[] }> = [
  { key: "r32", title: "Round of 32", stages: ["R32"] },
  { key: "r16", title: "Round of 16", stages: ["R16"] },
  { key: "qf", title: "Quarter-finals", stages: ["QF"] },
  { key: "sf", title: "Semi-finals", stages: ["SF"] },
  { key: "final", title: "Final", stages: ["third_place", "final"] },
];

const kickoffMs = (m: MatchSummary) => (m.kickoff_utc ? Date.parse(m.kickoff_utc) : NaN);

export function byKickoff(a: MatchSummary, b: MatchSummary): number {
  const ka = kickoffMs(a);
  const kb = kickoffMs(b);
  if (Number.isNaN(ka) && Number.isNaN(kb)) return a.match_id - b.match_id;
  if (Number.isNaN(ka)) return 1;
  if (Number.isNaN(kb)) return -1;
  return ka - kb || a.match_id - b.match_id;
}

function leagueRounds(matches: MatchSummary[], word: string): Round[] {
  const weeks = new Map<number, MatchSummary[]>();
  for (const m of matches) {
    const mw = m.matchweek;
    if (typeof mw !== "number" || !Number.isInteger(mw) || mw < 1) continue;
    const list = weeks.get(mw) ?? [];
    list.push(m);
    weeks.set(mw, list);
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([mw, list]) => ({ key: String(mw), title: `${word} ${mw}`, matches: list.sort(byKickoff) }));
}

function tournamentRounds(matches: MatchSummary[]): Round[] {
  const rounds: Round[] = [];
  // Group stage: each group's games in kickoff order, two per matchday.
  const groups = new Map<string, MatchSummary[]>();
  for (const m of matches) {
    if (m.stage !== "group") continue;
    const g = m.group ?? "";
    const list = groups.get(g) ?? [];
    list.push(m);
    groups.set(g, list);
  }
  if (groups.size > 0) {
    const days: MatchSummary[][] = [];
    for (const list of groups.values()) {
      const perDay = Math.max(1, Math.floor(list.length / 3) || 1);
      list.sort(byKickoff).forEach((m, i) => {
        const d = Math.min(Math.floor(i / perDay), 2);
        (days[d] ??= []).push(m);
      });
    }
    days.forEach((list, i) => {
      if (list?.length) {
        rounds.push({ key: `md${i + 1}`, title: `Group matchday ${i + 1}`, matches: list.sort(byKickoff) });
      }
    });
  }
  for (const stage of KNOCKOUT_STAGES) {
    const list = matches.filter((m) => stage.stages.includes(m.stage)).sort(byKickoff);
    if (list.length) rounds.push({ key: stage.key, title: stage.title, matches: list });
  }
  return rounds;
}

export function buildRounds(competition: CompetitionId, matches: readonly MatchSummary[]): Round[] {
  const list = [...matches];
  if (COMPETITIONS[competition].format === "knockout") return tournamentRounds(list);
  return leagueRounds(list, competition === "ucl" ? "Matchday" : "Matchweek").map((round) => ({
    ...round,
    matches: withoutTwinFixtures(round.matches),
  }));
}

/** How far along a row is: a played or live row beats one still "scheduled". */
function progress(m: MatchSummary): number {
  if (m.status === "finished") return 3;
  if (m.status === "in_play") return 2;
  return m.status === "scheduled" ? 0 : 1;
}

/** The live feeds list a few clubs under two names ("Racing Santander" and
 *  "Real Racing Club de Santander"), so the same fixture can arrive twice in a
 *  round: once with its result, once stuck on "scheduled". Two rows are the
 *  same fixture when both sides resolve to the same crest file; the row that
 *  is further along stays (earliest id on a tie). In a league a pairing can
 *  only happen once per round, so nothing real is dropped. */
export function withoutTwinFixtures(matches: readonly MatchSummary[]): MatchSummary[] {
  const best = new Map<string, MatchSummary>();
  const keyOf = (m: MatchSummary) => {
    const home = clubLogoSrc(m.teams.home);
    const away = clubLogoSrc(m.teams.away);
    return home && away ? `${home}|${away}` : null;
  };
  for (const m of matches) {
    const key = keyOf(m);
    if (!key) continue;
    const prev = best.get(key);
    if (
      !prev ||
      progress(m) > progress(prev) ||
      (progress(m) === progress(prev) && m.match_id < prev.match_id)
    ) {
      best.set(key, m);
    }
  }
  return matches.filter((m) => {
    const key = keyOf(m);
    return !key || best.get(key) === m;
  });
}

/** Live now, or still to kick off (a "scheduled" row whose kickoff has passed
 *  is feed lag or a ghost fixture -- it never makes a week current). */
function isAhead(m: MatchSummary, now: number): boolean {
  if (m.status === "in_play") return true;
  const k = kickoffMs(m);
  return (m.status === "scheduled" || m.status === "postponed") && !Number.isNaN(k) && k > now;
}

/** The round "Fixtures" opens on: the one holding a live match, else the next
 *  kick-off; with nothing ahead (season over, an archive) the last round. */
export function currentRoundIndex(rounds: readonly Round[], now: Date): number {
  if (rounds.length === 0) return -1;
  const t = now.getTime();
  const live = rounds.findIndex((r) => r.matches.some((m) => m.status === "in_play"));
  if (live >= 0) return live;
  let best = -1;
  let bestKick = Infinity;
  rounds.forEach((r, i) => {
    for (const m of r.matches) {
      if (!isAhead(m, t)) continue;
      const k = kickoffMs(m);
      if (k < bestKick) {
        bestKick = k;
        best = i;
      }
    }
  });
  return best >= 0 ? best : rounds.length - 1;
}

export function isRoundFinished(round: Round): boolean {
  return round.matches.length > 0 && round.matches.every((m) => m.status === "finished");
}

/** The round "Results" opens on: the current round once it is all played,
 *  else the latest earlier round with a result in it. */
export function resultsRoundIndex(rounds: readonly Round[], current: number): number {
  if (current < 0) return -1;
  if (isRoundFinished(rounds[current])) return current;
  for (let i = current - 1; i >= 0; i -= 1) {
    if (rounds[i].matches.some((m) => m.status === "finished")) return i;
  }
  return -1;
}

/** "2026–27" from the backend's tournament name ("Premier League 2026-27"),
 *  "2026" for a one-year tournament, else null. */
export function seasonFromName(name: string | null | undefined): string | null {
  const m = name?.match(/(\d{4})(?:\s*[-–/]\s*(\d{2,4}))?\s*$/);
  if (!m) return null;
  return m[2] ? `${m[1]}–${m[2].slice(-2)}` : m[1];
}

/** The season from the fixtures themselves, when the tournament name has
 *  none: a league that starts in July or later runs into the next year. */
export function seasonFromMatches(matches: readonly MatchSummary[]): string | null {
  const first = [...matches].sort(byKickoff)[0];
  const k = first ? kickoffMs(first) : NaN;
  if (Number.isNaN(k)) return null;
  const d = new Date(k);
  const y = d.getUTCFullYear();
  return d.getUTCMonth() >= 6 ? `${y}–${String((y + 1) % 100).padStart(2, "0")}` : String(y);
}

export type ModelVerdict = { kind: "exact" | "result" | "miss"; label: string; points: 5 | 2 | 0 };

const sign = (h: number, a: number) => Math.sign(h - a);

/** How the model's scoreline did on a finished match (the pick game's
 *  scoring: exact score 5, right result 2). Graded on the 90-minute score
 *  where the feed has one (the model predicts regulation goals only).
 *  Null when there is no result or no model scoreline to grade. */
export function modelVerdict(m: MatchSummary): ModelVerdict | null {
  if (m.status !== "finished" || !m.predicted_score) return null;
  const h = m.score_home_90 ?? m.score_home;
  const a = m.score_away_90 ?? m.score_away;
  if (h == null || a == null) return null;
  const { home: ph, away: pa } = m.predicted_score;
  if (ph == null || pa == null) return null;
  if (ph === h && pa === a) return { kind: "exact", label: "Exact score", points: 5 };
  if (sign(ph, pa) === sign(h, a)) return { kind: "result", label: "Right result", points: 2 };
  return { kind: "miss", label: "Missed", points: 0 };
}

/** The model's points for a round, or null unless every match is finished
 *  and gradable (never a partial total dressed up as the week's). */
export function modelRoundPoints(round: Round): number | null {
  if (!isRoundFinished(round)) return null;
  let total = 0;
  for (const m of round.matches) {
    const v = modelVerdict(m);
    if (!v) return null;
    total += v.points;
  }
  return total;
}

/** The winner of a decided knockout match (penalties count), else null. */
export function knockoutWinner(m: MatchSummary): string | null {
  if (m.status !== "finished" || m.score_home == null || m.score_away == null) return null;
  if (m.score_home !== m.score_away) return m.score_home > m.score_away ? m.teams.home : m.teams.away;
  if (m.penalty_home != null && m.penalty_away != null && m.penalty_home !== m.penalty_away) {
    return m.penalty_home > m.penalty_away ? m.teams.home : m.teams.away;
  }
  return null;
}

const MODEL_FIELDS = {
  predicted_winner: null,
  probabilities: null,
  predicted_score: null,
  confidence: null,
  live_probabilities: null,
} as const;

/** The match with the model's call removed -- what the server hands the page
 *  for a fixture whose call may not be shown to everyone yet, so the HTML and
 *  the page's data payload never carry it. */
export function withoutModel(m: MatchSummary): MatchSummary {
  return { ...m, ...MODEL_FIELDS };
}

const NUMBER_WORDS = [
  "No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen",
  "Nineteen", "Twenty",
];

/** "Ten matches", "One match", "24 matches". */
export function matchCountLabel(n: number): string {
  const word = NUMBER_WORDS[n] ?? String(n);
  return `${word} ${n === 1 ? "match" : "matches"}`;
}
