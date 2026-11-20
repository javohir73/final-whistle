import type { Metadata } from "next";
import { getNrlTipsheetServer } from "@/lib/api";
import { APP_NAME } from "@/lib/constants";
import { Button, EmptyState, PageHead } from "@/components/ui";
import { NrlTipsLeaderboard } from "@/components/nrl/NrlTipsLeaderboard";
import { nrlSeasonState } from "@/lib/nrlTips";

/** /nrl/leaderboard (prototype `pageNrlBoard`): the season's tipping
 *  standings, the model ranked among the tippers. Built here on the NRL board
 *  component (the shared /leaderboard page is the football board). */
export const metadata: Metadata = {
  title: `NRL tipping leaderboard — ${APP_NAME}`,
  description:
    "Season standings for NRL tips against the model: one point for each winner tipped, the model ranked among the tippers.",
  alternates: { canonical: "/nrl/leaderboard" },
};

export const revalidate = 300;

export default async function NrlLeaderboardPage() {
  const tipsheet = await getNrlTipsheetServer().catch(() => null);
  const season = tipsheet?.season ?? null;
  const complete = tipsheet ? nrlSeasonState([{ matches: tipsheet.matches }]) === "complete" : false;

  return (
    <>
      <PageHead
        eyebrow={season ? `NRL · ${season} season` : "NRL"}
        title="Leaderboard"
        sub={
          complete
            ? `The final ${season} standings. One point for each winner tipped.`
            : "The season standings so far. One point for each winner tipped."
        }
      />
      {season != null ? (
        <NrlTipsLeaderboard season={season} seasonOnly title={null} className="max-w-[900px]" />
      ) : (
        <EmptyState className="max-w-[900px]" title="The leaderboard is not available right now">
          Try again in a minute.
        </EmptyState>
      )}
      {season != null && !complete ? (
        <p className="mt-6">
          <Button href="/nrl/tips">Tip this round</Button>
        </p>
      ) : null}
    </>
  );
}
