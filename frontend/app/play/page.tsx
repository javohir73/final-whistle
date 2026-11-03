import type { Metadata } from "next";
import { getKnockoutOddsServer, getNrlTipsheetServer } from "@/lib/api";
import { parseCompetition } from "@/lib/competitionPrefs";
import { readServerCompetition } from "@/lib/competitionServer";
import { nrlSeasonStart, nrlSeasonState } from "@/lib/nrlTips";
import { getCompetitionTournament } from "@/lib/tournament";
import type { TournamentOdds } from "@/lib/types";
import type { BracketChampion } from "@/components/play/PlayBracketCard";
import { PlayHub } from "./PlayHub";
import { COMPETITIONS, type CompetitionId } from "@/lib/sports";

// The page is request-dependent (?competition=, else the visitor's current
// competition), so it renders per request; the backend fetches below keep
// their own Data Cache revalidate, and picks and leaderboards still resolve
// inside the client sections.
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
  // `?competition=` when it names a real competition (parseCompetition is an
  // own-property check: "toString" is not a competition), else the visitor's
  // current competition -- the same scope the nav shows (middleware's
  // x-fw-comp / the fw_comp cookie, then geo, then EPL). An NRL or La Liga
  // visitor's Play tab therefore opens on their own competition.
  const raw = (await searchParams)?.competition;
  const selectedCompetition: CompetitionId =
    parseCompetition(Array.isArray(raw) ? raw[0] : raw) ?? (await readServerCompetition());

  const [nrlTipsheet, tournament, odds] = await Promise.all([
    getNrlTipsheetServer().catch(() => null),
    selectedCompetition === "wc26" ? getCompetitionTournament("wc26") : null,
    selectedCompetition === "wc26" ? getKnockoutOddsServer().catch(() => null) : null,
  ]);

  // The World Cup is a past tournament with a bracket by definition; the
  // tournament lookup only refines that when it actually ran.
  const hasBrackets = tournament?.has_brackets ?? COMPETITIONS.wc26.hasBracket;
  const champion = hasBrackets && odds ? topChampion(odds) : null;

  // The tipsheet is the current round; the shared rule reads it as a draw of one.
  const nrlRounds = nrlTipsheet ? [{ matches: nrlTipsheet.matches }] : null;
  const nrlState = nrlRounds ? nrlSeasonState(nrlRounds) : null;

  return (
    <PlayHub
      selectedCompetition={selectedCompetition}
      nrlTipsheet={nrlTipsheet}
      nrlState={nrlState}
      nrlOpensAt={nrlState === "pre-season" && nrlRounds ? nrlSeasonStart(nrlRounds) : null}
      hasBrackets={hasBrackets}
      champion={champion}
    />
  );
}
