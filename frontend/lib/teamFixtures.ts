/** Server-safe fixture selection for the club page (shared by the server page,
 *  which trims what it sends, and the client list). */

export type Score = { home: number; away: number };

/** One fixture as the club page needs it. `model` is the model's score and is
 *  set by the server ONLY where everyone may see it (finished, kicked off, or
 *  a competition without a pick game); for an open fixture it stays absent and
 *  is fetched on the client once the viewer's own pick is locked. A full
 *  MatchSummary is assignable (extra fields are ignored). */
export interface TeamFixture {
  match_id: number;
  kickoff_utc: string | null;
  status: string;
  teams: { home: string; away: string };
  score_home?: number | null;
  score_away?: number | null;
  matchweek?: number | null;
  stage?: string | null;
  group?: string | null;
  competition?: string | null;
  model?: Score | null;
}

function byKickoff(a: TeamFixture, b: TeamFixture): number {
  if (!a.kickoff_utc) return 1;
  if (!b.kickoff_utc) return -1;
  return a.kickoff_utc < b.kickoff_utc ? -1 : a.kickoff_utc > b.kickoff_utc ? 1 : 0;
}

export function hasScore(m: TeamFixture): boolean {
  return m.score_home != null && m.score_away != null;
}

/** The rows a club page shows: the latest result, then the next `upcoming`
 *  fixtures that will really be played (a cancelled match, or a postponed one
 *  still carrying its old kickoff, is never "next"). `all` lists everything
 *  in date order (the World Cup archive). */
export function selectTeamFixtures(
  matches: TeamFixture[],
  { now, upcoming = 2, all = false }: { now: number; upcoming?: number; all?: boolean },
): TeamFixture[] {
  const sorted = [...matches].sort(byKickoff);
  if (all) return sorted;
  const played = sorted.filter((m) => (m.status === "finished" || m.status === "in_play") && hasScore(m));
  const last = played[played.length - 1];
  const next = sorted
    .filter(
      (m) =>
        m.status === "scheduled" &&
        m.kickoff_utc != null &&
        Date.parse(m.kickoff_utc) > now,
    )
    .slice(0, upcoming);
  const live = sorted.filter((m) => m.status === "in_play" && m !== last);
  return [...(last ? [last] : []), ...live, ...next];
}

