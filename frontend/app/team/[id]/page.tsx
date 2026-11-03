import type { Metadata } from "next";
import { APP_NAME } from "@/lib/constants";
import { redirectLegacyTeam } from "@/lib/competitionServer";

/** /team/:id is a lookup, not a page: it 308s to the team's own
 *  /football/{comp}/team/:id (WC26 when the backend can't say), replacing a
 *  static redirect that sent every club to the World Cup archive. Thrown from
 *  ./layout.tsx for the same loading.tsx reason as app/match/[id]/page.tsx. */
export const metadata: Metadata = {
  title: `Team — ${APP_NAME}`,
  robots: { index: false, follow: true },
};

export default async function LegacyTeamLookupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return redirectLegacyTeam(id);
}
