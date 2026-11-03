import type { Probabilities } from "@/lib/types";
import { pctTriple } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  probabilities: Probabilities;
  homeLabel?: string;
  awayLabel?: string;
  showLabels?: boolean;
  /** Bar height: "default" (today's h-3), "hero" (prototype feature bar,
   *  h-[7px]), "row" (prototype timeline bar, h-[5px]). Visual only -- the
   *  role="img" + printed-percentage aria-label below is unaffected. */
  size?: "hero" | "row" | "default";
}

const SIZE_HEIGHT: Record<NonNullable<Props["size"]>, string> = {
  hero: "h-[7px]",
  row: "h-[5px]",
  default: "h-3",
};

/** Horizontal W/D/L stacked bar — the signature visual of a prediction.
 *
 *  The printed numbers come from pctTriple (largest-remainder rounding), so the
 *  legend and the aria-label always add up to exactly 100 and always agree.
 *  The legend names every outcome ("Brazil 62% · Draw 24% · Serbia 14%"): a
 *  bare "62% · 24% draw · 14%" left the reader to guess which side was which. */
export function ProbabilityBar({
  probabilities,
  homeLabel = "Home",
  awayLabel = "Away",
  showLabels = true,
  size = "default",
}: Props) {
  const { home_win, draw, away_win } = probabilities;
  const t = pctTriple(probabilities);
  const seg = (w: number) => ({ width: `${Math.max(0, w * 100)}%` });

  return (
    <div>
      <div
        className={cn("flex w-full gap-0.5 overflow-hidden rounded-full", SIZE_HEIGHT[size])}
        role="img"
        aria-label={`${homeLabel} win ${t.home}%, draw ${t.draw}%, ${awayLabel} win ${t.away}%`}
      >
        <div className="rounded-l-full bg-win" style={seg(home_win)} />
        <div className="bg-draw" style={seg(draw)} />
        <div className="rounded-r-full bg-loss" style={seg(away_win)} />
      </div>
      {showLabels && (
        // Decorative twin of the aria-label above (screen readers get the
        // numbers once, from the bar). Names truncate; numbers never do.
        <div
          aria-hidden="true"
          className="mt-2 flex items-baseline justify-between gap-3 text-label font-semibold tabular-nums"
        >
          <span className="flex min-w-0 gap-1 text-lime-deep">
            <span className="truncate">{homeLabel}</span>
            <span className="shrink-0">{t.home}%</span>
          </span>
          <span className="shrink-0 text-draw-ink">Draw {t.draw}%</span>
          <span className="flex min-w-0 justify-end gap-1 text-loss-ink">
            <span className="truncate">{awayLabel}</span>
            <span className="shrink-0">{t.away}%</span>
          </span>
        </div>
      )}
    </div>
  );
}
