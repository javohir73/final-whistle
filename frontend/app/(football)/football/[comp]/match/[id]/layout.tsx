import { notFound } from "next/navigation";
import { getMatchServer, getMatchSummaryServer } from "@/lib/api";
import { isWiredFootballCompetition } from "@/lib/sports";

/** Real 404s for /football/{comp}/match/{id}. The page's own notFound() runs
 *  inside this segment's loading.tsx Suspense boundary, where it streams as
 *  HTTP 200 + noindex (a soft 404 -- live on /football/wc26/match/198, a
 *  Premier League id). A segment's layout renders before that boundary, so
 *  the same decision made here is a real 404.
 *
 *  It mirrors the page's rule exactly -- 404 only when BOTH the scoped
 *  prediction and the scoped summary are missing (a tie with a summary but
 *  no prediction yet renders the pending view) -- and only on the backend's
 *  definitive 404: an error defers to the page. The page makes the same two
 *  calls, which request memoisation answers from these, so a valid id pays
 *  no extra round trip; its loading skeleton still covers the page's
 *  secondary reads. */
export default async function CompMatchLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ comp: string; id: string }>;
}) {
  const { comp, id } = await params;
  // Match ids are integers (the backend 422s anything else).
  if (!isWiredFootballCompetition(comp) || !/^\d+$/.test(id)) notFound();
  const unknown = () => undefined;
  const [prediction, summary] = await Promise.all([
    getMatchServer(id, comp).catch(unknown),
    getMatchSummaryServer(id, comp).catch(unknown),
  ]);
  if (prediction === null && summary === null) notFound();
  return children;
}
