import type { Prediction } from "@/lib/types";
import { pctTriple, topOutcome } from "@/lib/format";

/** Model vs market on the match page, as ONE row: the model's favoured outcome
 *  next to the bookmaker consensus on that same outcome (median across
 *  bookmakers, margin removed), and the gap in points. It used to stack two
 *  more W/D/L bars under the hero's -- the third and fourth copies of the same
 *  split on the page. Probabilities only: no prices, no bookmaker names, and
 *  the standing not-betting-advice framing. When no snapshot exists it says so
 *  in one line rather than disappearing. (Distinct from MarketComparison, the
 *  methodology page's aggregate benchmark table.) */
export function ModelVsMarket({
  prediction,
  home,
  away,
}: {
  prediction: Prediction;
  home: string;
  away: string;
}) {
  const oc = prediction.odds_comparison;
  if (!oc?.available || !oc.market) {
    return (
      <p className="text-sm leading-relaxed text-muted">
        Market consensus isn&apos;t available for this fixture yet.
      </p>
    );
  }

  const side = topOutcome(prediction.probabilities);
  const label = side === "home" ? home : side === "away" ? away : "Draw";
  const model = pctTriple(prediction.probabilities)[side];
  const market = pctTriple(oc.market)[side];
  const gap = model - market;
  const signed = gap > 0 ? `+${gap}` : gap < 0 ? `−${Math.abs(gap)}` : "±0";

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-label font-semibold uppercase tracking-wider text-muted">
          Model vs market
        </span>
        <span className="text-sm tabular-nums text-foreground">
          <strong className="font-semibold">{label}:</strong> model {model}% · market {market}%{" "}
          <span className="text-muted">(model {signed} pts)</span>
        </span>
      </div>
      <p className="mt-1 text-label leading-snug text-muted">
        Bookmaker consensus: median across bookmakers, margin removed. Not betting advice.
      </p>
    </div>
  );
}
