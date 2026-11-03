import { ProbabilityBar } from "@/components/ProbabilityBar";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { KnockoutAdvanceCard } from "@/components/KnockoutAdvanceCard";
import { BasisTag, KnockoutDrawNote, ShootoutNote } from "@/components/ShootoutNote";
import { formatScore, pct } from "@/lib/format";
import { prematchCall, type Verdict } from "@/lib/verdict";
import type { MatchPhase } from "@/lib/matchStatus";
import type { KnockoutAdvance, PredictedScore, Probabilities } from "@/lib/types";

/** The model's call, inside the match hero: ONE sentence, ONE labelled W/D/L
 *  bar (summing to 100), and two chips -- the most likely scoreline and the
 *  confidence tier. It replaces a second card that repeated the predicted
 *  score three times, drew the split twice more and wrapped the headline % in a
 *  ring as well.
 *
 *  Live, the bar becomes the in-play win chance (labelled as such) and the
 *  sentence becomes the pre-match read. At a confirmed full time the verdict
 *  chip grades the call; a pending result is never graded. */
export function ModelCall({
  home,
  away,
  probabilities,
  liveProbabilities,
  predicted,
  confidence,
  phase,
  hasActual,
  knockout,
  stage,
  verdict,
}: {
  home: string;
  away: string;
  /** The pre-match model probabilities. */
  probabilities: Probabilities;
  /** In-play win probability; shown in place of the pre-match bar while live. */
  liveProbabilities?: Probabilities | null;
  predicted: PredictedScore;
  confidence: string | null;
  phase: MatchPhase;
  /** A real score exists (live, final or pending). */
  hasActual: boolean;
  knockout?: KnockoutAdvance | null;
  stage?: string | null;
  verdict: Verdict | null;
}) {
  const live = phase === "live";
  const shownLive = live && liveProbabilities ? liveProbabilities : null;
  const call = prematchCall(probabilities, { home, away });
  const underway = live || phase === "finished" || phase === "stale";
  const sentence = call ? (underway ? `Pre-match: ${call.label}` : call.label) : null;
  const scoreline =
    predicted.home != null && predicted.away != null
      ? formatScore(predicted.home, predicted.away)
      : null;
  // Until a result is confirmed, a knockout tie still needs resolving past the
  // 90th minute: the v0.5 advance block when the prediction carries it, else
  // the plain draw qualifier. A pending result shows neither (nor a verdict).
  const unresolved = phase !== "finished" && phase !== "stale";

  return (
    <div className="px-5 pb-5 pt-4">
      {shownLive ? (
        <p className="flex items-center gap-1.5 text-label font-bold uppercase tracking-[0.16em] text-loss-ink">
          <span className="status-live-dot h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
          Live win chance
        </p>
      ) : (
        <p className="text-label font-semibold uppercase tracking-[0.16em] text-muted">
          Model&apos;s call
        </p>
      )}

      {sentence && (
        <p className="mt-1.5 font-display text-lg font-extrabold tracking-tight text-foreground">
          {sentence}
        </p>
      )}

      <div className="mt-3">
        <ProbabilityBar
          probabilities={shownLive ?? probabilities}
          homeLabel={home}
          awayLabel={away}
          size="hero"
        />
      </div>

      {(scoreline || confidence) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {scoreline && (
            <span className="inline-flex items-center rounded-full bg-surface-2 px-2.5 py-1 text-label font-semibold tabular-nums text-foreground">
              {hasActual
                ? `Model predicted ${scoreline}`
                : `Most likely ${scoreline}${predicted.probability != null ? ` · ${pct(predicted.probability)}` : ""}`}
            </span>
          )}
          <ConfidenceBadge level={confidence} />
        </div>
      )}

      {unresolved && knockout && <KnockoutAdvanceCard knockout={knockout} home={home} away={away} />}
      {unresolved && !knockout && <KnockoutDrawNote stage={stage} />}

      {verdict && (
        <p className="mt-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              verdict.kind === "miss" ? "bg-loss/15 text-loss-ink" : "bg-win/15 text-lime-deep"
            }`}
          >
            <span aria-hidden>{verdict.kind === "miss" ? "✕" : "✓"}</span>
            {verdict.label}
            <BasisTag verdict={verdict} />
          </span>
        </p>
      )}
      {verdict && <ShootoutNote verdict={verdict} />}
    </div>
  );
}
