import type { Metadata } from "next";
import { APP_NAME } from "@/lib/constants";
import LeaderboardPage from "../../leaderboard/page";

/** The NRL tipping board. This used to re-export /leaderboard's page whole,
 *  which (with no ?competition=) rendered the World Cup bracket board under
 *  an NRL URL. It now renders the same page pinned to "nrl" -- no request
 *  read, so the route stays static-capable. */
export const metadata: Metadata = {
  title: `NRL tipping leaderboard — ${APP_NAME}`,
  description:
    "Season and round standings for NRL tips against the model: who called the most winners this season.",
  alternates: { canonical: "/nrl/leaderboard" },
};

export default function NrlLeaderboardPage() {
  return LeaderboardPage({ searchParams: Promise.resolve({ competition: "nrl" }) });
}
