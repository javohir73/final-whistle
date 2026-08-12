import type { Metadata } from "next";
import { APP_NAME } from "@/lib/constants";
import { getLeaderboardServer, getNrlTipsheetServer } from "@/lib/api";
import { COMPETITIONS, type CompetitionId } from "@/lib/sports";
import { LeaderboardClient } from "./LeaderboardClient";

export const metadata: Metadata = {
  title: `Leaderboard — ${APP_NAME}`,
  description:
    "See how public brackets rank — points for group, knockout, finalist, and champion picks.",
};

/** Server-rendered: the leaderboard table (or empty state) is in the first HTML.
 *  The signed-in rank card hydrates client-side. */
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ competition?: string | string[] }>;
}) {
  const raw = (await searchParams)?.competition;
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  const competition: CompetitionId =
    candidate && candidate in COMPETITIONS ? (candidate as CompetitionId) : "wc26";
  const [initialRows, nrlTipsheet] = await Promise.all([
    competition === "wc26" ? getLeaderboardServer().catch(() => null) : null,
    competition === "nrl" ? getNrlTipsheetServer().catch(() => null) : null,
  ]);
  return (
    <LeaderboardClient
      competition={competition}
      initialRows={initialRows ?? undefined}
      nrlSeason={nrlTipsheet?.season ?? null}
    />
  );
}
