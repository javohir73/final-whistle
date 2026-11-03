import { guardScopedMatch } from "@/lib/competitionServer";

/** Real 404s (and moves) for /football/{comp}/match/{id}. The page's own
 *  notFound() runs inside this segment's loading.tsx Suspense boundary, where
 *  it streams as HTTP 200 + noindex (a soft 404). A segment's layout renders
 *  before that boundary, so the guard decides here: 404 an unknown or
 *  non-numeric id, 308 a club id requested under the wrong competition (e.g.
 *  the old /football/wc26/match/198 links) to its own, and let the page render
 *  otherwise -- including whenever the backend is slow or erroring, so the
 *  skeleton still streams. See lib/competitionServer.ts guardScopedMatch. */
export default async function CompMatchLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ comp: string; id: string }>;
}) {
  const { comp, id } = await params;
  await guardScopedMatch(comp, id);
  return children;
}
