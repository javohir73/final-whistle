import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getKnockoutOddsServer, getUpcomingMatchesServer } from "@/lib/api";
import { parseCompetition } from "@/lib/competitionPrefs";
import { readServerCompetition } from "@/lib/competitionServer";
import { getCompetitionTournament } from "@/lib/tournament";
import { pickGameFor } from "@/lib/reveal";
import type { TournamentOdds } from "@/lib/types";
import { PlayBracketCard, type BracketChampion } from "@/components/play/PlayBracketCard";
import { MyPicks } from "@/components/play/MyPicks";
import { EmptyState, GhostButton, Main, PageHead, TextLink } from "@/components/ui";
import { COMPETITIONS, competitionLinks, type CompetitionId } from "@/lib/sports";

// The page is request-dependent (?competition=, else the visitor's current
// competition), so it renders per request; the picks themselves resolve
// client-side (device-scoped, never in server HTML).
export const revalidate = 300;

export const metadata: Metadata = {
  title: "My picks — Premier League, La Liga and Bundesliga score picks",
  description:
    "Pick the scores against FinalWhistle's model, matchweek by matchweek: 5 points for an exact score, 2 for the right result, every pick graded on a public leaderboard.",
  alternates: { canonical: "/play" },
};

/** The model's predicted champion for the bracket card: the top-`win_title`
 *  team. Filters out null win_title first so a pre-simulation payload (every
 *  win_title null) yields null -- PlayBracketCard then degrades to a plain link
 *  rather than printing a "—%" champion. */
function topChampion(odds: TournamentOdds[]): BracketChampion | null {
  const top = odds
    .filter((o) => o.win_title != null)
    .sort((a, b) => (b.win_title ?? 0) - (a.win_title ?? 0))[0];
  return top ? { team: top.team, winTitle: top.win_title as number } : null;
}

type PlayPageProps = {
  searchParams?: Promise<{ competition?: string | string[]; mw?: string | string[] }>;
};

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** "My picks" for one competition (the prototype's pagePicks). `?competition=`
 *  when it names a real competition, else the visitor's current competition
 *  (the same scope the nav shows). `?mw=` opens an earlier or later matchweek.
 *  Club leagues with a score-pick game get the matchweek list; the NRL keeps
 *  its own tips page; the finished World Cup is an archive; anything else
 *  (the Champions League today) says picks are not open. */
export default async function PlayPage({ searchParams }: PlayPageProps) {
  const params = (await searchParams) ?? {};
  const competition: CompetitionId =
    parseCompetition(first(params.competition)) ?? (await readServerCompetition());
  const mwRaw = Number(first(params.mw));
  const matchweek = Number.isInteger(mwRaw) && mwRaw >= 1 ? mwRaw : null;
  const config = COMPETITIONS[competition];
  const links = competitionLinks(competition);

  if (competition === "nrl") redirect(links.picks);
  // UFC has no picks game (a crafted ?competition=ufc, or an old cookie).
  if (competition === "ufc") redirect(links.home);

  if (competition === "wc26") {
    const [tournament, odds] = await Promise.all([
      getCompetitionTournament("wc26"),
      getKnockoutOddsServer().catch(() => null),
    ]);
    const hasBrackets = tournament?.has_brackets ?? config.hasBracket;
    const champion = hasBrackets && odds ? topChampion(odds) : null;
    return (
      <>
        <PageHead
          eyebrow={`${config.label} · Past tournament`}
          title="My picks"
          sub="The World Cup is over and its picks are closed. The bracket and the bracket leaderboard stay here."
        />
        <Main className="max-w-[900px]">
          {hasBrackets ? <PlayBracketCard champion={champion} /> : null}
          <p>
            <TextLink href={links.leaderboard}>Bracket leaderboard</TextLink>
          </p>
        </Main>
      </>
    );
  }

  if (pickGameFor(competition) !== "league_tips") {
    return (
      <>
        <PageHead eyebrow={config.label} title="My picks" />
        <Main className="max-w-[900px]">
          <EmptyState
            title="Picks are not open for this competition"
            actions={<GhostButton href={links.home}>See its matches</GhostButton>}
          >
            {config.label} score picks are not open yet. The model’s call on every match is on its match pages.
          </EmptyState>
        </Main>
      </>
    );
  }

  // Venues only (the picks themselves are device-scoped and load client-side;
  // nothing of the model's call leaves the server here).
  const schedule = await getUpcomingMatchesServer(competition).catch(() => null);
  const venues: Record<number, string> = {};
  for (const m of schedule ?? []) if (m.venue) venues[m.match_id] = m.venue;

  return <MyPicks competition={competition} matchweek={matchweek} venues={venues} />;
}
