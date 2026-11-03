import type { Metadata } from "next";
import { APP_NAME } from "@/lib/constants";
import { getLeaderboardServer, getNrlTipsheetServer } from "@/lib/api";
import { readServerCompetition } from "@/lib/competitionServer";
import { parseCompetition } from "@/lib/competitionPrefs";
import { LeaderboardClient } from "./LeaderboardClient";

export const metadata: Metadata = {
  title: `My picks: your record against the model — ${APP_NAME}`,
  description:
    "Your picks, your points and where you stand against the model and other players in the competition you follow.",
  alternates: { canonical: "/leaderboard" },
};

type LeaderboardPageProps = {
  searchParams?: Promise<{ competition?: string | string[] }>;
};

/** Server-rendered: the leaderboard table (or empty state) is in the first HTML.
 *  The signed-in rank card hydrates client-side. The board follows
 *  `?competition=` when given (so `?competition=wc26` still opens the World
 *  Cup bracket board), else the visitor's current competition -- fw_comp
 *  cookie, then geo, then EPL (lib/competitionServer.ts). It used to default
 *  to the finished World Cup. Reading the request is free here: the page is
 *  dynamic anyway (searchParams). */
export default async function LeaderboardPage({ searchParams }: LeaderboardPageProps) {
  const raw = (await searchParams)?.competition;
  const competition =
    parseCompetition(Array.isArray(raw) ? raw[0] : raw) ?? (await readServerCompetition());
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
