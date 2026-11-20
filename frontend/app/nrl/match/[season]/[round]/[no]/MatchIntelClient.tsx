"use client";

import { Card, Note } from "@/components/ui";
import { sections, MODEL_SECTION_IDS } from "./sections";
import type { NrlMatchDetail, NrlProbHistory } from "@/lib/types";

/** The match-intelligence sections, stacked as cards, driven by the
 *  `sections` array. On an open match (`revealed` false) the sections that
 *  carry the model's call (overview, model, try-scorer chances) are left out
 *  -- the page has already stripped the prediction server-side. */
export function MatchIntelClient({
  detail,
  probHistory,
  revealed = true,
}: {
  detail: NrlMatchDetail;
  probHistory: NrlProbHistory | null;
  revealed?: boolean;
}) {
  // A finished match's score is in the hero; the live card only earns its
  // place while the match is on.
  const finished = detail.match.status === "finished";
  const shown = sections.filter(
    (s) => (revealed || !MODEL_SECTION_IDS.includes(s.id)) && !(finished && s.id === "live"),
  );
  const ps = revealed ? detail.prediction?.predicted_score : null;

  return (
    <div className="flex flex-col gap-6">
      {ps && detail.prediction?.predicted_total != null && (
        <Card pad>
          <Note>Predicted score</Note>
          <p className="text-h2 font-semibold text-ink">
            {detail.match.home} {ps.home}–{ps.away} {detail.match.away}
          </p>
          <Note className="mt-1">{Math.round(detail.prediction.predicted_total)} total points</Note>
        </Card>
      )}

      {shown.map((s) => {
        const Section = s.render;
        return (
          <section key={s.id} id={s.id} aria-label={s.label} className="scroll-mt-24">
            <Section detail={detail} probHistory={probHistory} />
          </section>
        );
      })}
    </div>
  );
}
