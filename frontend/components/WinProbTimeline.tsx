/** WinProbTimeline (Floodlight P4 slice p4-s1): the match centre's win-probability
 *  chart (design/Floodlight Prototype.dc.html, match-centre lines 235-245). For
 *  football this is the model's PRE-MATCH forecast trajectory — dated snapshots
 *  leading up to kickoff, from getProbHistory* — rendered as an honest "how the
 *  model's read shifted" line, NOT a fabricated minute-by-minute in-match chart
 *  (there is no minute field or goal-event alignment in that payload). Goal/event
 *  markers are supported structurally (optional `markers`) for NRL reuse later;
 *  football passes none.
 *
 *  Deterministic server component: no "use client", no window/hooks, so it renders
 *  identical markup server- and client-side. When there are <2 points there is no
 *  trajectory to draw, so it renders NOTHING (the caller drops the section): the
 *  match hero already carries the one W/D/L bar, and a second "fallback" copy of
 *  it here was a duplicate, not a forecast. Never a fake chart.
 *
 *  Honest axis: the series ends "KO" only once kickoff has actually passed.
 *  Before that the last snapshot is just the latest one ("Latest · 3 Nov").
 */
import type { ProbHistoryPoint } from "@/lib/types";
import { Eyebrow } from "@/components/Eyebrow";
import { pct } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  points: ProbHistoryPoint[];
  homeLabel: string;
  /** Kickoff (UTC ISO). The end label says "KO" only when this is in the past
   *  relative to `now`; unknown kickoff never claims KO. */
  kickoffUtc?: string | null;
  /** Render clock, injectable for tests (server render time otherwise). */
  now?: Date;
  /** Optional event markers (NRL reuse): `at` is a 0..1 fractional x position,
   *  `tone` picks the ring color. Football passes none. */
  markers?: { at: number; tone: "home" | "away" }[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Compact "D MMM" from an ISO-ish date string, by string-parsing the YYYY-MM-DD
 *  prefix so the label stays byte-deterministic (no Intl/tz dependence in this
 *  pure server component). Null for anything that doesn't parse. */
function shortDate(iso: string | null): string | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month}` : null;
}

/** Round to 2dp so the emitted SVG coordinates stay short and deterministic. */
const r2 = (v: number) => Math.round(v * 100) / 100;

/** True when the forecast has a trajectory worth drawing. Callers use this to
 *  decide whether the forecast section exists at all. */
export function hasForecastTrajectory(points: ProbHistoryPoint[] | null | undefined): boolean {
  return (points?.length ?? 0) >= 2;
}

export function WinProbTimeline({ points, homeLabel, kickoffUtc = null, now, markers = [] }: Props) {
  // No trajectory to draw yet (most fixtures until the model starts updating
  // them): render nothing rather than a second copy of the hero's bar.
  if (!hasForecastTrajectory(points)) return null;

  const series = points.map((p) => p.p_home);
  const n = series.length;
  const first = series[0];
  const last = series[n - 1];

  // Prototype geometry: viewBox 354x80, home 100% -> y 0 (top), home 0% -> y 80.
  const xFor = (i: number) => (i / (n - 1)) * 354;
  const yFor = (p: number) => (1 - p) * 80;
  // Linear interpolation of y at a fractional x (0..1) — markers sit on the path.
  const interpY = (at: number) => {
    const posn = Math.min(Math.max(at, 0), 1) * (n - 1);
    const i0 = Math.floor(posn);
    const i1 = Math.min(i0 + 1, n - 1);
    const t = posn - i0;
    return yFor(series[i0] + (series[i1] - series[i0]) * t);
  };

  const d = series.map((p, i) => `${i === 0 ? "M" : "L"}${r2(xFor(i))} ${r2(yFor(p))}`).join(" ");

  // Axis labels: honest steps, never fabricated KO/1H/HT/2H minutes. Dated
  // snapshots print first/mid dates and end at "KO" only once kickoff has
  // passed -- before that the last point is simply the latest snapshot.
  // Undated series fall to EARLIER…NOW.
  const dated = points.some((p) => p.date);
  const kickoffMs = kickoffUtc ? Date.parse(kickoffUtc) : NaN;
  const kickoffPassed =
    Number.isFinite(kickoffMs) && (now ?? new Date()).getTime() >= kickoffMs;
  const latest = shortDate(points[n - 1].date);
  const axisLabels = dated
    ? [
        shortDate(points[0].date) ?? "EARLIER",
        shortDate(points[Math.floor((n - 1) / 2)].date) ?? "",
        kickoffPassed ? "KO" : latest ? `Latest · ${latest}` : "Latest",
      ]
    : ["EARLIER", "NOW"];

  // The text alternative (aria-label + <svg> <title>): names the printed current
  // % and direction so the visual is never color-alone.
  const label = `Model forecast for ${homeLabel}: moved from ${pct(first)} to ${pct(last)} across ${n} updates`;

  return (
    <div>
      <div className="flex justify-between">
        <Eyebrow tone="muted">WIN PROBABILITY · FORECAST</Eyebrow>
        <span className="text-label font-semibold tabular-nums text-lime-deep">
          {homeLabel} {pct(last)}
        </span>
      </div>

      <svg
        role="img"
        aria-label={label}
        viewBox="0 0 354 80"
        preserveAspectRatio="none"
        width="100%"
        height="80"
        className="mt-2.5"
      >
        <title>{label}</title>
        {/* 50% reference baseline. */}
        <line
          x1={0}
          y1={40}
          x2={354}
          y2={40}
          strokeWidth={1}
          strokeDasharray="3 3"
          className="[stroke:hsl(var(--border))]"
        />
        {/* The forecast trajectory. */}
        <path
          d={d}
          fill="none"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="stroke-lime-deep"
        />
        {/* Optional event markers (NRL reuse; football passes none). */}
        {markers.map((mk, i) => (
          <circle
            key={i}
            cx={r2(mk.at * 354)}
            cy={r2(interpY(mk.at))}
            r={4}
            strokeWidth={2}
            className={cn(
              "[fill:hsl(var(--surface))]",
              mk.tone === "home" ? "stroke-lime-deep" : "stroke-loss",
            )}
          />
        ))}
        {/* Current (last) point. */}
        <circle cx={354} cy={r2(yFor(last))} r={3.5} className="fill-lime-deep" />
      </svg>

      <div className="flex justify-between text-label text-muted">
        {axisLabels.map((t, i) => (
          <span key={i}>{t}</span>
        ))}
      </div>
    </div>
  );
}
