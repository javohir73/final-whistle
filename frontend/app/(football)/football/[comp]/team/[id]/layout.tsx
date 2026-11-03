import { notFound } from "next/navigation";
import { getTeamServer } from "@/lib/api";
import { isWiredFootballCompetition } from "@/lib/sports";

/** Real 404s for /football/{comp}/team/{id}: decided here, before the
 *  segment's loading.tsx boundary starts streaming (a page-level notFound()
 *  behind it is a soft 404 -- see ../../match/[id]/layout.tsx). Same rule as
 *  the page: 404 when the backend says the team is not in this competition;
 *  an error defers to the page. The page's identical getTeamServer call is
 *  answered from this one (request memoisation). */
export default async function CompTeamLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ comp: string; id: string }>;
}) {
  const { comp, id } = await params;
  if (!isWiredFootballCompetition(comp) || !/^\d+$/.test(id)) notFound();
  const profile = await getTeamServer(id, comp).catch(() => undefined);
  if (profile === null) notFound();
  return children;
}
