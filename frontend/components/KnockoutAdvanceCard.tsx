import type { KnockoutAdvance } from "@/lib/types";
import { pct } from "@/lib/format";

/** "Who goes through" for a knockout tie (model v0.5).
 *
 *  The win/draw/loss bar above stops at the 90th minute; this section resolves
 *  the tie: a two-sided advance bar (no draw slice — someone must go through,
 *  ink for the home side, line-strong for the away side), each side's route
 *  split (in 90 / extra time / penalties, unconditional so the three sum to the
 *  side's advance probability), and the tie-level chance of extra time and a
 *  shootout. Shown only where the model's call is (the caller gates it). */
export function KnockoutAdvanceCard({
  knockout,
  home,
  away,
}: {
  knockout: KnockoutAdvance;
  home: string;
  away: string;
}) {
  const { p_advance_home: ph, p_advance_away: pa, paths } = knockout;
  const seg = (w: number) => ({ width: `${Math.max(0, w * 100)}%` });
  const rows: Array<{ label: string; key: keyof typeof paths.home }> = [
    { label: "in 90 minutes", key: "win_90" },
    { label: "in extra time", key: "win_et" },
    { label: "on penalties", key: "win_pens" },
  ];

  return (
    <div className="mt-6 border-t border-line-soft pt-5">
      <p className="text-notes font-semibold text-ink">Who goes through</p>
      <div
        className="mt-3 flex h-3 w-full gap-[3px] overflow-hidden rounded-full"
        role="img"
        aria-label={`${home} advance ${pct(ph)}, ${away} advance ${pct(pa)}`}
      >
        <div className="rounded-[3px] bg-ink" style={seg(ph)} />
        <div className="rounded-[3px] bg-line-strong" style={seg(pa)} />
      </div>
      <div className="mt-2 flex justify-between gap-3 text-notes tabular-nums">
        <span className="font-semibold text-ink">{home} {pct(ph)}</span>
        <span className="text-right font-semibold text-muted">{away} {pct(pa)}</span>
      </div>
      <div className="mt-3 space-y-1">
        {rows.map(({ label, key }) => (
          <div
            key={key}
            className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-notes tabular-nums"
          >
            <span className="text-right font-semibold text-ink">{pct(paths.home[key])}</span>
            <span className="w-32 text-center text-label text-muted">{label}</span>
            <span className="text-left font-semibold text-ink">{pct(paths.away[key])}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-notes text-muted">
        A draw above means level after 90 minutes: {pct(knockout.p_extra_time)} chance this tie
        needs extra time, {pct(knockout.p_shootout)} that it reaches penalties.
      </p>
    </div>
  );
}
