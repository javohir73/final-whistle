"use client";

import { useEffect, useState } from "react";
import { FixturePair, GhostButton } from "@/components/ui";
import { wholePct } from "@/lib/nrlDisplay";
import { sideName, useMyNrlRound, visibleModel } from "./useMyNrlRound";

function shortSide(pick: "home" | "draw" | "away", m: { home: string | null; away: string | null }) {
  return pick === "draw" ? "Draw" : sideName(pick, m);
}

/** The right side of an OPEN or LIVE NRL fixture row: "Tip" until the viewer
 *  has tipped it, then "You X / Model X 64%". The model's call comes from
 *  /tips/mine after mount and only shows once tipped or kicked off (the reveal
 *  rule) -- the server never passes it in, so cached HTML carries no numbers.
 *  Every cell on a page shares the same (season, round) read. */
export function NrlTipCell({
  season,
  round,
  matchId,
  home,
  away,
  tipHref = "/nrl/tips",
}: {
  season: number;
  round: number;
  matchId: number;
  home: string;
  away: string;
  tipHref?: string;
}) {
  const mine = useMyNrlRound(season, round);
  // Clock after mount only (hydration-safe): null on the server pass.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const tipButton = (
    <GhostButton href={tipHref} aria-label={`Tip ${home} v ${away}`}>
      Tip
    </GhostButton>
  );
  if (mine.status !== "ready") return mine.status === "error" ? tipButton : null;
  const m = mine.byId[matchId];
  if (!m) return tipButton;
  const tip = m.your_tip;
  const model = visibleModel(m, now);
  const kickedOff = now != null && m.kickoff_utc != null && Date.parse(m.kickoff_utc) <= now.getTime();
  if (!tip && !model) return kickedOff || m.status !== "scheduled" ? null : tipButton;
  const rows: Array<{ label: string; value: string; you?: boolean }> = [];
  if (tip) rows.push({ label: "You", value: shortSide(tip.pick, m), you: true });
  if (model) rows.push({ label: `Model ${shortSide(model.pick, m)}`, value: wholePct(model.pick_confidence) });
  return <FixturePair rows={rows} />;
}
