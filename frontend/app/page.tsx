import type { Metadata } from "next";
import { APP_NAME } from "@/lib/constants";
import { DEFAULT_COMPETITION } from "@/lib/sports";
import { MatchweekPage } from "@/components/matchweek/MatchweekPage";
import { HomeCompetitionSwitch } from "@/components/matchweek/HomeCompetitionSwitch";

// Static + ISR: the home opens on this week's matches. The server renders the
// default competition (the Premier League); a visitor who remembers another
// competition is switched on the client (no cookies() here, see app/layout.tsx).
export const revalidate = 300;

export const metadata: Metadata = {
  title: `${APP_NAME} — Sports predictions, clearly explained`,
  description:
    "Football and NRL predictions: this week's matches, call each score before kick-off, then see the model's.",
};

export default function HomePage() {
  return (
    <>
      <HomeCompetitionSwitch shown={DEFAULT_COMPETITION} />
      <MatchweekPage competition={DEFAULT_COMPETITION} />
    </>
  );
}
