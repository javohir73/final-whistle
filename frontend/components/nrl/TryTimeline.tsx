import type { NrlTryEventOut } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Wave 2 stats section: chronological try list with the running score.
 *  Pure/presentational -- no fetching. `homeTeam`/`awayTeam` are optional
 *  labels only (used to colour-code each row); a null side still renders,
 *  just without the win/loss tint. */
export function TryTimeline({
  events,
  homeTeam,
  awayTeam,
}: {
  events: NrlTryEventOut[];
  homeTeam: string | null;
  awayTeam: string | null;
}) {
  return (
    <div className="rounded-card border border-line bg-ground px-4 py-5 min-[900px]:px-7 min-[900px]:py-6">
      <h3 className="text-sm font-semibold text-muted">
        Try timeline
      </h3>
      {events.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No tries recorded for this match.</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {events.map((e, i) => {
            const isHome = e.team === homeTeam;
            return (
              <li key={`${e.minute}-${e.player}-${i}`} className="flex items-center gap-3">
                <span className="min-w-[40px] text-right text-sm font-semibold tabular-nums text-muted">
                  {e.minute}&apos;
                </span>
                <span
                  className={cn(
                    "rounded-lg px-2 py-1 text-xs font-bold",
                    isHome ? "bg-brand-soft text-brand" : "bg-miss-soft text-miss",
                  )}
                >
                  {e.team}
                </span>
                <span className="flex-1 truncate text-sm text-ink">{e.player}</span>
                <span className="text-sm font-semibold tabular-nums text-ink">
                  {e.score_home}–{e.score_away}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-4 text-label text-muted">
        {homeTeam ?? "Home"} left, {awayTeam ?? "Away"} right.
      </p>
    </div>
  );
}
