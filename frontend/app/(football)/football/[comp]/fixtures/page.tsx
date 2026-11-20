import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { APP_NAME } from "@/lib/constants";
import { COMPETITIONS, isWiredFootballCompetition } from "@/lib/sports";
import { MatchweekPage, roundParam } from "@/components/matchweek/MatchweekPage";

// The fixtures URL stays (search results, old links, the nav lights Matches
// here) but shows the same per-matchweek view as the competition home -- one
// matchweek at a time with arrows, not the whole season in one list.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ comp: string }>;
}): Promise<Metadata> {
  const { comp } = await params;
  const label = isWiredFootballCompetition(comp) ? COMPETITIONS[comp].label : "Football";
  return {
    title: `${label} fixtures — ${APP_NAME}`,
    description: `${label} fixtures and results, one matchweek at a time.`,
    alternates: { canonical: `/football/${comp}/fixtures` },
  };
}

export default async function CompFixturesPage({
  params,
  searchParams,
}: {
  params: Promise<{ comp: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { comp } = await params;
  if (!isWiredFootballCompetition(comp)) notFound();
  const query = (await searchParams) ?? {};
  return <MatchweekPage competition={comp} round={roundParam(query.mw)} />;
}
