import type { FeatureWeight } from "@/lib/types";

const LABELS: Record<string, string> = {
  elo_gap: "Elo gap",
  form_last10: "Recent form",
  head_to_head: "Head-to-head",
  host_advantage: "Host advantage",
  goals_for_avg: "Scoring rate",
  form_channels: "Attack/defence form",
};

/** Weights are normalized shares (the model's factors sum to 1). Clamp so a
 *  malformed payload can't draw past the track. */
const share = (w: number) => Math.min(1, Math.max(0, w));
const fmt = (w: number) => share(w).toFixed(2);

/** The top factors behind a prediction, as a sorted bar list.
 *
 *  Plain HTML/CSS on purpose: this used to be a recharts BarChart, which put
 *  ~98 kB gzip of recharts + lodash on the match page's critical path to draw
 *  five bars. No hooks and no "use client", so it renders on the server and
 *  ships no JS. The bars are decorative (aria-hidden); assistive tech gets the
 *  same numbers from an sr-only table. Values print as relative weights, not
 *  "%", which read as a win probability. */
export function FeatureImportanceChart({ features }: { features: FeatureWeight[] }) {
  if (!features.length) return null;
  const rows = [...features]
    .sort((a, b) => b.weight - a.weight)
    .map((f) => ({ key: f.name, label: LABELS[f.name] ?? f.name, weight: f.weight }));

  return (
    <div>
      <div data-feature-bars aria-hidden="true" className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-[6.5rem_minmax(0,1fr)_2.25rem] items-center gap-3">
            <span className="truncate text-meta text-foreground">{r.label}</span>
            <span className="h-[18px] overflow-hidden rounded-r-md bg-surface-2">
              <span
                data-weight={String(r.weight)}
                className="block h-full min-w-[2px] rounded-r-md bg-lime-deep"
                style={{ width: `${Math.round(share(r.weight) * 100)}%` }}
              />
            </span>
            <span className="text-right text-label font-semibold tabular-nums text-feature-chart-ink">
              {fmt(r.weight)}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-label text-muted">Relative weight · the factors sum to 1</p>
      <table className="sr-only">
        <caption>What drove this prediction: relative weight of each factor (they sum to 1)</caption>
        <thead>
          <tr>
            <th scope="col">Factor</th>
            <th scope="col">Relative weight</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.label}</th>
              <td>{fmt(r.weight)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
