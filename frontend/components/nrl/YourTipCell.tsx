"use client";

import { CheckIcon } from "@/components/ui";
import { cn } from "@/lib/utils";
import { sideName, useMyNrlRound } from "./useMyNrlRound";

/** The "You" half of the Grand Final strip on the NRL home: the viewer's REAL
 *  tip for that match, read from /tips/mine after mount. Nothing at all for a
 *  visitor who did not tip it (never a sample tip). */
export function YourTipCell({
  season,
  round,
  matchId,
  winner,
  className,
}: {
  season: number;
  round: number;
  matchId: number;
  /** "home" | "away" | "draw" result of the finished match, to grade the tip. */
  winner: "home" | "away" | "draw" | null;
  className?: string;
}) {
  const mine = useMyNrlRound(season, round);
  if (mine.status !== "ready") return null;
  const m = mine.byId[matchId];
  const tip = m?.your_tip;
  if (!m || !tip) return null;
  const right = winner != null && tip.pick === winner;
  return (
    <div className={cn("px-4 py-5 min-[900px]:px-7 min-[900px]:py-6", className)}>
      <div className="text-notes text-muted">You</div>
      <div className="text-h2 font-semibold text-ink">
        {tip.pick === "draw" ? "Tipped a draw" : `Tipped ${sideName(tip.pick, m)}`}
      </div>
      {winner != null ? (
        <div
          className={cn(
            "mt-2 inline-flex items-center gap-1.5 text-notes font-semibold",
            right ? "text-brand" : "text-miss",
          )}
        >
          {right ? <CheckIcon /> : null}
          {right ? "Right result" : "Missed"}
        </div>
      ) : null}
    </div>
  );
}
