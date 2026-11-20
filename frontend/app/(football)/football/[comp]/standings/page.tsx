import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { COMPETITIONS, isWiredFootballCompetition } from "@/lib/sports";
import { getGroupsServer, getUpcomingMatchesServer } from "@/lib/api";
import { matchweeksPlayed, nextFixtureByClub } from "@/lib/standingsRows";
import { getCompetitionTournament } from "@/lib/tournament";
import { StandingsClient } from "@/components/StandingsClient";

export const revalidate = 60; // ISR window: rendered on demand, then served from the CDN for 60 s
// No paths are prebuilt (the competition/id space is data-driven); an empty
// list is what switches this dynamic segment from per-request rendering to ISR.
export async function generateStaticParams() {
  return [];
}

// Canonical standings URL for league-format football competitions. WC26 keeps
// its group-table implementation at /football/wc26/groups, even though the
// visible navigation label is the clearer, prototype-aligned “Standings.”

export async function generateMetadata({
  params,
}: {
  params: Promise<{ comp: string }>;
}): Promise<Metadata> {
  const { comp } = await params;
  const wired = isWiredFootballCompetition(comp);
  const label = wired ? COMPETITIONS[comp].label : "Football";
  // The description is not optional here. Without one this page inherited the
  // root layout's, which was built from the ACTIVE tournament — so the EPL
  // standings page carried a La Liga description whenever the pipeline was
  // pointed at La Liga. Every competition page states its own competition.
  const term = wired ? COMPETITIONS[comp].terms.standings : "Standings";
  return {
    title: `${label} ${term.toLowerCase()}`,
    description: `Live ${label} ${term.toLowerCase()} with played, won, drawn, lost, goals for and against, goal difference and points.`,
    alternates: { canonical: `/football/${comp}/standings` },
  };
}

export default async function CompStandingsPage({
  params,
}: {
  params: Promise<{ comp: string }>;
}) {
  const { comp } = await params;
  if (!isWiredFootballCompetition(comp) || COMPETITIONS[comp].format !== "league") notFound();

  // One request for the competition's fixtures gives every club's next match
  // (the "Next" column) and how many matchweeks are done. Only names, ids and
  // kickoffs cross to the client — never the model's numbers.
  const [initialGroups, tournament, fixtures] = await Promise.all([
    getGroupsServer(comp).catch(() => null),
    getCompetitionTournament(comp),
    getUpcomingMatchesServer(comp).catch(() => null),
  ]);
  return (
    <StandingsClient
      comp={comp}
      initialGroups={initialGroups ?? undefined}
      tournament={tournament}
      nextByClub={fixtures ? nextFixtureByClub(fixtures) : undefined}
      played={fixtures ? matchweeksPlayed(fixtures) : null}
    />
  );
}
