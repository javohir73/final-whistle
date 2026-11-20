import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getNrlTipsheetServer } from "@/lib/api";
import { EmptyState, PageHead, TextLink } from "@/components/ui";
import { nrlSeasonStart, nrlSeasonState, nrlStartLabel } from "@/lib/nrlTips";
import { NrlTipsPlaySection } from "@/components/nrl/NrlTipsPlaySection";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "NRL tips — beat the model | FinalWhistle",
  description:
    "Tip the winner of every NRL match, one point each, and see how you go against the FinalWhistle model. Its call on a match shows once you have tipped it.",
  alternates: { canonical: "/nrl/tips" },
};

/** /nrl/tips -- "My tips" (prototype `pageNrlPicks`). Off-season: a single
 *  empty state. Otherwise the round to tip (PlayRound: the model's call on a
 *  match only after you tip it, or after kick-off), you v the model, and the
 *  round's leaderboard. The read-only round view lives at /nrl/round/[n]. */
export default async function NrlTipsPage() {
  const tipsheet = await getNrlTipsheetServer().catch(() => null);
  if (!tipsheet) notFound();
  const rounds = [{ matches: tipsheet.matches }];
  const seasonState = nrlSeasonState(rounds);
  const season = tipsheet.season;

  if (seasonState === "complete") {
    return (
      <>
        <PageHead eyebrow={`NRL · ${season} season`} title="My tips" sub="Tips are closed for the off-season." />
        <EmptyState
          className="max-w-[900px]"
          title={`Tips reopen for Round 1 in March ${season + 1}`}
          actions={<TextLink href="/nrl/record">See how the model went in {season}</TextLink>}
        >
          Pick a winner for every match, then see how you went against the model.
        </EmptyState>
      </>
    );
  }

  const opensAt = seasonState === "pre-season" ? nrlSeasonStart(rounds) : null;
  return (
    <>
      <PageHead
        eyebrow={`NRL · ${season} season · Round ${tipsheet.round}`}
        title="My tips"
        sub={
          opensAt
            ? `Round 1 starts ${nrlStartLabel(opensAt)}. Tip the winner of every match, one point each.`
            : "Tip the winner of every match, one point each. You can change a tip until kick-off."
        }
      />
      <NrlTipsPlaySection season={season} round={tipsheet.round} />
    </>
  );
}
