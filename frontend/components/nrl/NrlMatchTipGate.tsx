"use client";

import { useEffect, useState } from "react";
import { Button, Card, CardHead, FixturePair, LockedList, Note } from "@/components/ui";
import { expectedMarginLabel } from "@/lib/format";
import { wholePct } from "@/lib/nrlDisplay";
import { sideName, useMyNrlRound, visibleModel } from "./useMyNrlRound";

/** The match page's model card for an OPEN match. The server sends no model
 *  numbers for it; this reads the viewer's tip (and, once tipped, the model's
 *  call) from /tips/mine after mount. Before a tip: what unlocks, and a way to
 *  tip. After: "You X / Model X 64%". */
export function NrlMatchTipGate({
  season,
  round,
  matchId,
  home,
  away,
  hasPrediction,
}: {
  season: number;
  round: number;
  matchId: number;
  home: string;
  away: string;
  /** Whether the model has frozen a call yet (no numbers, just yes/no). */
  hasPrediction: boolean;
}) {
  const mine = useMyNrlRound(season, round);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  const m = mine.status === "ready" ? mine.byId[matchId] : undefined;
  const tip = m?.your_tip ?? null;
  const model = visibleModel(m, now);

  if (tip) {
    return (
      <Card pad aria-labelledby="nrl-tip-gate" className="fw-rise">
        <CardHead id="nrl-tip-gate" title="Your tip and the model’s" />
        <div className="mt-4 flex">
          <FixturePair
            className="!flex-row !items-start gap-x-8"
            rows={[
              { label: "You", value: tip.pick === "draw" ? "Draw" : sideName(tip.pick, { home, away }), you: true },
              ...(model
                ? [{ label: `Model ${model.pick === "draw" ? "Draw" : sideName(model.pick, { home, away })}`, value: wholePct(model.pick_confidence) }]
                : []),
            ]}
          />
        </div>
        {model?.expected_margin != null ? (
          <Note className="mt-3">Expected margin: {expectedMarginLabel(model.expected_margin, home, away)}.</Note>
        ) : !model ? (
          <Note className="mt-3">The model’s call lands before kick-off.</Note>
        ) : (
          <Note className="mt-3">Shown because you have tipped this match. You can change your tip until kick-off.</Note>
        )}
      </Card>
    );
  }

  return (
    <Card pad aria-labelledby="nrl-tip-gate">
      <CardHead id="nrl-tip-gate" title={hasPrediction ? "Unlocked when you tip this match" : "Tip this match"} />
      {hasPrediction ? (
        <LockedList items={["The model’s pick", "How sure it is", "The margin it expects"]} />
      ) : (
        <Note className="mt-2">The model freezes its call in the lead-up to the round.</Note>
      )}
      <div className="mt-5">
        <Button href="/nrl/tips">Tip Round {round}</Button>
      </div>
    </Card>
  );
}
