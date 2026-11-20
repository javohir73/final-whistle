import Link from "next/link";
import type { IntelSectionProps } from "./sections";

export function ModelSection({ detail }: IntelSectionProps) {
  const { prediction, match } = detail;
  if (!prediction) {
    return (
      <div className="rounded-card border border-line bg-ground px-4 py-5 min-[900px]:px-7 min-[900px]:py-6 text-center text-sm text-muted">
        Model breakdown lands once the prediction is frozen.
      </div>
    );
  }
  const confidence = Math.max(prediction.home_prob, prediction.away_prob);

  return (
    <div className="rounded-card border border-line bg-ground px-4 py-5 min-[900px]:px-7 min-[900px]:py-6">
      <h2 className="mb-4 text-h2 font-semibold text-ink">Model</h2>

      <p className="text-label font-medium text-muted">Elo comparison</p>
      <EloBars homeProb={prediction.home_prob} awayProb={prediction.away_prob}
               home={match.home} away={match.away} />

      {detail.factors.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-label font-medium text-muted">
            What&apos;s driving this
          </p>
          <div className="space-y-2">
            {detail.factors.map((f) => (
              <div key={f.key} className="flex items-center gap-2">
                <span className="w-32 shrink-0 text-xs text-muted">{f.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-soft">
                  <i
                    className={f.favors === "home" ? "block h-full bg-brand" : "block h-full bg-miss"}
                    style={{ width: `${Math.round(f.weight * 100)}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-ink">
                  {Math.round(f.weight * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-5 border-t border-line-soft pt-4 text-xs leading-relaxed text-muted">
        Confidence {Math.round(confidence * 100)}% · model {prediction.model_version} ·{" "}
        <Link href="/nrl/record" className="font-semibold text-brand">
          Full model record →
        </Link>
      </p>
    </div>
  );
}

function EloBars({
  homeProb, awayProb, home, away,
}: {
  homeProb: number; awayProb: number; home: string | null; away: string | null;
}) {
  const total = homeProb + awayProb || 1;
  const homePct = Math.round((homeProb / total) * 100);
  return (
    <div className="mt-2">
      <div className="flex h-3 overflow-hidden rounded-full bg-soft">
        <i className="block h-full bg-brand" style={{ width: `${homePct}%` }} />
        <i className="block h-full bg-miss" style={{ width: `${100 - homePct}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-muted">
        <span>{home ?? "Home"}</span>
        <span>{away ?? "Away"}</span>
      </div>
    </div>
  );
}
