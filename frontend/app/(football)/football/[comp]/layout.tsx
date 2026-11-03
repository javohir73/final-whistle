import { notFound } from "next/navigation";
import { isWiredFootballCompetition } from "@/lib/sports";

/** One check for every /football/{comp}/... route: an unknown or unwired
 *  competition segment is a real 404. This layout sits above every
 *  competition page's loading.tsx boundary, so the 404 is decided before
 *  anything streams; the pages' own checks run behind those boundaries, where
 *  notFound() streams as HTTP 200 -- and with ISR each junk path
 *  (/football/<anything>/fixtures) would be cached as its own soft 404. */
export default async function CompetitionSegmentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ comp: string }>;
}) {
  const { comp } = await params;
  if (!isWiredFootballCompetition(comp)) notFound();
  return children;
}
