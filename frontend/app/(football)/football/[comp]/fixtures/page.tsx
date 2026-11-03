import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { APP_NAME } from "@/lib/constants";
import { COMPETITIONS, isWiredFootballCompetition } from "@/lib/sports";
import { renderMatchesPage } from "@/app/matches/MatchesPageContent";

export const revalidate = 60; // ISR window: rendered on demand, then served from the CDN for 60 s
// No paths are prebuilt (the competition/id space is data-driven); an empty
// list is what switches this dynamic segment from per-request rendering to ISR.
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ comp: string }>;
}): Promise<Metadata> {
  const { comp } = await params;
  const label = isWiredFootballCompetition(comp) ? COMPETITIONS[comp].label : "Football";
  return {
    title: `${label} fixtures — ${APP_NAME}`,
    description: `Every ${label} fixture, organized by kickoff and match status.`,
    alternates: { canonical: `/football/${comp}/fixtures` },
  };
}

export default async function CompFixturesPage({
  params,
}: {
  params: Promise<{ comp: string }>;
}) {
  const { comp } = await params;
  if (!isWiredFootballCompetition(comp)) notFound();
  return renderMatchesPage(comp);
}
