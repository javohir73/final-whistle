import { guardScopedTeam } from "@/lib/competitionServer";

/** Real 404s (and moves) for /football/{comp}/team/{id}, decided before the
 *  segment's loading.tsx boundary streams -- see ../../match/[id]/layout.tsx
 *  and lib/competitionServer.ts guardScopedTeam. */
export default async function CompTeamLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ comp: string; id: string }>;
}) {
  const { comp, id } = await params;
  await guardScopedTeam(comp, id);
  return children;
}
