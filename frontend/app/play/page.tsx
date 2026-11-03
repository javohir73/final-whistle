import type { Metadata } from "next";
import { getKnockoutOddsServer, getNrlTipsheetServer } from "@/lib/api";
import { getCompetitionTournament } from "@/lib/tournament";
import type { NrlTipsheet, TournamentOdds } from "@/lib/types";
import type { BracketChampion } from "@/components/play/PlayBracketCard";
import { PlayHub, type NrlSeasonState } from "./PlayHub";
import { COMPETITIONS, type CompetitionId } from "@/lib/sports";

// Same ISR posture as /nrl/tips and /tips -- the shell is evergreen (nothing
// user-specific here; picks and leaderboards resolve inside the client
// sections), so the round rolls week to week under one stable URL.
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Beat the model — Premier League, La Liga, Bundesliga and NRL picks",
  description:
    "Pick the scores against FinalWhistle's model, matchweek by matchweek: 5 points for an exact score, 2 for the right result, every pick graded on a public leaderboard.",
  alternates: { canonical: "/play" },
};

/** The model's predicted champion for the bracket card: the top-`win_title`
 *  team. Filters out null win_title first so a pre-simulation payload (every
 *  win_title null) yields null -- PlayBracketCard then degrades to a plain link
 *  rather than printing a "—%" champion. Mirrors AIBracket's champion pick in
 *  app/brackets/BracketsClient.tsx (sort by win_title desc), minus the topology. */
function topChampion(odds: TournamentOdds[]): BracketChampion | null {
  const top = odds
    .filter((o) => o.win_title != null)
    .sort((a, b) => (b.win_title ?? 0) - (a.win_title ?? 0))[0];
  return top ? { team: top.team, winTitle: top.win_title as number } : null;
}

const SEASON_OVER_AFTER_DAYS = 21;

/** Where the NRL season stands, from the current-round tipsheet alone: a
 *  round with something still to tip is open; nothing to tip after a single
 *  decided final (the Grand Final), or weeks after the last kickoff, is a
 *  finished season; anything else is the gap between two rounds. */
function nrlSeasonState(tipsheet: NrlTipsheet, now: Date = new Date()): NrlSeasonState {
  const t = now.getTime();
  const open = tipsheet.matches.some(
    (m) =>
      m.status === "in_play" ||
      (m.status === "scheduled" && (m.kickoff_utc == null || Date.parse(m.kickoff_utc) > t)),
  );
  if (open) return "open";
  const final = tipsheet.matches.length === 1 && tipsheet.matches[0].status === "finished";
  const kickoffs = tipsheet.matches
    .map((m) => (m.kickoff_utc ? Date.parse(m.kickoff_utc) : NaN))
    .filter((x) => !Number.isNaN(x));
  const stale = kickoffs.length > 0 && t - Math.max(...kickoffs) > SEASON_OVER_AFTER_DAYS * 86_400_000;
  return final || stale ? "complete" : "between-rounds";
}

/** The Play hub ("Beat the model"): every competition you can play against
 *  the model, current competition first. Server-fetches, in parallel: the
 *  current NRL round (always -- it's ISR-cached, and the NRL section can now
 *  be opened client-side alongside others), plus the World Cup tournament and
 *  knockout odds only when the World Cup is the requested competition (its
 *  bracket card degrades to a plain link otherwise). Each degrades honestly
 *  to null/false so the hub always renders. League tips carry no public seed
 *  (they resolve client-side). */
type PlayPageProps = {
  searchParams?: Promise<{ competition?: string | string[] }>;
};

export default async function PlayPage({ searchParams }: PlayPageProps) {
  const raw = (await searchParams)?.competition;
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  const selectedCompetition: CompetitionId =
    candidate && candidate in COMPETITIONS ? (candidate as CompetitionId) : "epl";

  const [nrlTipsheet, tournament, odds] = await Promise.all([
    getNrlTipsheetServer().catch(() => null),
    selectedCompetition === "wc26" ? getCompetitionTournament("wc26") : null,
    selectedCompetition === "wc26" ? getKnockoutOddsServer().catch(() => null) : null,
  ]);

  // The World Cup is a past tournament with a bracket by definition; the
  // tournament lookup only refines that when it actually ran.
  const hasBrackets = tournament?.has_brackets ?? COMPETITIONS.wc26.hasBracket;
  const champion = hasBrackets && odds ? topChampion(odds) : null;

  return (
    <PlayHub
      selectedCompetition={selectedCompetition}
      nrlTipsheet={nrlTipsheet}
      nrlState={nrlTipsheet ? nrlSeasonState(nrlTipsheet) : null}
      hasBrackets={hasBrackets}
      champion={champion}
    />
  );
}
