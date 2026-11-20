"use client";

import { Chip } from "@/components/ui";
import { sideName, useMyNrlRound } from "./useMyNrlRound";

/** Under the model's call once tipping is over: the viewer's REAL tip for the
 *  match (read from /tips/mine after mount) and, when finished, whether it was
 *  right. Nothing at all for a visitor who did not tip it. */
export function NrlYourTipLine({
  season,
  round,
  matchId,
  home,
  away,
  winner,
}: {
  season: number;
  round: number;
  matchId: number;
  home: string;
  away: string;
  winner: "home" | "away" | "draw" | null;
}) {
  const mine = useMyNrlRound(season, round);
  if (mine.status !== "ready") return null;
  const tip = mine.byId[matchId]?.your_tip;
  if (!tip) return null;
  const right = winner != null ? tip.pick === winner : null;
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-soft pt-4">
      <span className="text-notes text-muted">
        Your tip{" "}
        <b className="font-semibold text-brand">{tip.pick === "draw" ? "Draw" : sideName(tip.pick, { home, away })}</b>
      </span>
      {right != null ? <Chip tone={right ? "ok" : "miss"}>{right ? "Right result" : "Missed"}</Chip> : null}
    </div>
  );
}
