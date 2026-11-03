import { notFound } from "next/navigation";
import { COMPETITIONS, isWiredFootballCompetition } from "@/lib/sports";

/** Group tables exist only where the registry says hasGroups (WC26); leagues
 *  keep their table at /standings. The check lives in this layout, not just
 *  the pages: groups/loading.tsx wraps both pages in Suspense, so a page-level
 *  notFound() streamed as a 200 with a not-found body (a soft 404, live on
 *  /football/epl/groups). A segment's layout renders outside its own loading
 *  boundary, so this 404 is a real HTTP 404, for /groups and /groups/[id]. */
export default async function CompGroupsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ comp: string }>;
}) {
  const { comp } = await params;
  if (!isWiredFootballCompetition(comp) || !COMPETITIONS[comp].hasGroups) notFound();
  return children;
}
