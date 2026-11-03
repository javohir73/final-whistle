import type { Metadata } from "next";
import { APP_NAME } from "@/lib/constants";
import { getUpcomingMatchesServer } from "@/lib/api";
import { MatchesClient } from "./MatchesClient";
import type { CompetitionId } from "@/lib/sports";

export const metadata: Metadata = {
  title: `Fixtures — ${APP_NAME}`,
  description:
    "Every WC26 fixture with live scores and the model's pre-kickoff win probabilities, filterable by upcoming, live, or finished.",
};

/** Server-rendered: the fixture list is in the first HTML. The client island
 *  owns filters/sort and polls every 30s for live scores, seeded with this data. */
export async function renderMatchesPage(competition: CompetitionId = "wc26") {
  const initialMatches = await getUpcomingMatchesServer(competition).catch(() => null);
  return (
    <MatchesClient
      initialMatches={initialMatches ?? undefined}
      competition={competition}
      // The server's clock for the first (hydrating) render: day labels and the
      // stuck-live check agree with the browser instead of mismatching on a
      // cached page (see components/match/clock.ts).
      renderedAt={new Date().toISOString()}
    />
  );
}

export default async function MatchesPage() {
  return renderMatchesPage();
}
