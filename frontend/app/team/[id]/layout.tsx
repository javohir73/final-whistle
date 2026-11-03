import { redirectLegacyTeam } from "@/lib/competitionServer";

/** Runs the /team/:id lookup before any streamed output, outside the
 *  segment's loading.tsx boundary, so the 308 and the 404 are real HTTP
 *  statuses (see app/match/[id]/layout.tsx). Never renders its children. */
export default async function LegacyTeamLookupLayout({
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return redirectLegacyTeam(id);
}
