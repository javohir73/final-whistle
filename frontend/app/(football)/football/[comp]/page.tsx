import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { COMPETITIONS, isWiredFootballCompetition } from "@/lib/sports";
import { APP_NAME } from "@/lib/constants";
import { MatchweekPage, roundParam } from "@/components/matchweek/MatchweekPage";

// The football scope 404s non-football competitions (for example NRL) that
// reach /football/<comp>; NRL keeps its own namespace. Every football
// competition opens on its matchweek (the World Cup archive on its rounds);
// `?mw=` pages through them so links and Back work.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ comp: string }>;
}): Promise<Metadata> {
  const { comp } = await params;
  const label = isWiredFootballCompetition(comp) ? COMPETITIONS[comp].label : "Football";
  return {
    title: `${label} predictions — ${APP_NAME}`,
    description: `This week's ${label} fixtures and results. Call each score before kick-off, then see the model's.`,
    // Explicit: next.config.mjs 301s several legacy paths into this one, and a
    // competition home is otherwise reachable via the pinned-competition
    // redirect too. Without a canonical those all look like separate pages.
    alternates: { canonical: `/football/${comp}` },
  };
}

export default async function CompHomePage({
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
