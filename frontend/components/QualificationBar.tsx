import { pct } from "@/lib/format";

/** Per-team qualification probability bar for the group tables. Exposed as a
 *  labelled image so a screen reader inside the standings cell announces e.g.
 *  "Top 2 chance 87%" rather than a bare "87%" with no context. Direction G:
 *  one brand bar on a quiet track; the printed % carries the number. */
export function QualificationBar({ prob }: { prob: number | null }) {
  const value = Math.max(0, Math.min(1, prob ?? 0));
  return (
    <div className="flex items-center gap-2.5" role="img" aria-label={`Top 2 chance ${pct(prob)}`}>
      <div className="h-1.5 w-10 overflow-hidden rounded-full bg-line-soft sm:w-20">
        <div
          className={value >= 0.5 ? "h-full rounded-full bg-brand" : "h-full rounded-full bg-line-strong"}
          style={{ width: `${value * 100}%` }}
        />
      </div>
      <span className="w-10 text-right text-table font-semibold tabular-nums text-ink">{pct(prob)}</span>
    </div>
  );
}
