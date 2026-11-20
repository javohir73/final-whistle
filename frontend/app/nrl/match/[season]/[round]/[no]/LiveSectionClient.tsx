"use client";

import { createPortal } from "react-dom";
import { pct } from "@/lib/format";
import type { NrlLive } from "@/lib/types";

/** Presentational half of the Wave 3 "live" section: the in-flow
 *  scoreboard/events card, plus — only while `live.status === "live"` — a
 *  compact fixed strip (minute + score + live win prob) pinned just below
 *  the app header (`top-14`, under the header's z-50) so a live match is
 *  visible the moment the page loads, regardless of where sections.ts
 *  places this card in the stacked DOM order. The strip is portalled to
 *  document.body: the page's `.fade-up` wrapper animates with fill-mode
 *  `both`, ending on `transform: translateY(0)`, and any non-`none`
 *  transform makes that ancestor the containing block for `position: fixed`
 *  descendants — a strip rendered in place would anchor to the wrapper and
 *  scroll away with it instead of pinning to the viewport. Pure function of
 *  already-fetched data — LiveMatchProvider owns the 30-second polling feed. */
export function LiveSectionClient({
  home, away, live,
}: { home: string; away: string; live: NrlLive }) {
  const isLive = live.status === "live";

  const pinnedStrip =
    isLive && typeof document !== "undefined"
      ? createPortal(
          <div
            className="pointer-events-none fixed inset-x-0 top-14 z-40 px-4"
          >
            <div
              aria-hidden="true"
              className="pointer-events-auto mx-auto flex max-w-2xl items-center justify-between gap-3 rounded-xl border border-line-soft bg-ground px-4 py-2 text-sm shadow-menu"
            >
              <span className="flex items-center gap-1.5 font-semibold text-ink">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-miss" aria-hidden />
                LIVE{live.minute != null ? ` · ${live.minute}′` : ""}
              </span>
              <span className="tabular-nums text-ink">
                {home} {live.score_home ?? "–"}&ndash;{live.score_away ?? "–"} {away}
              </span>
              <span className="font-bold tabular-nums text-brand">{pct(live.live_home_prob)}</span>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {pinnedStrip}
      <div className="rounded-card border border-line bg-ground px-4 py-5 min-[900px]:px-7 min-[900px]:py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-h2 font-semibold text-ink">{isLive ? "Live" : "Final"}</h2>
          {isLive && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-miss-soft px-2.5 py-1 text-label font-semibold text-miss">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden />
              Live{live.minute != null ? ` · ${live.minute}′` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center justify-center gap-6">
          <TeamScore name={home} score={live.score_home} />
          <span className="text-2xl font-semibold tabular-nums text-muted">&ndash;</span>
          <TeamScore name={away} score={live.score_away} />
        </div>
        <p className="mt-4 text-center text-sm font-semibold text-brand">
          {home} win chance &middot; {pct(live.live_home_prob)}
        </p>
        {live.events.length > 0 && (
          <ul className="mt-5 space-y-1.5 border-t border-line-soft pt-4 text-sm">
            {live.events.map((e, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="text-muted">
                  {e.minute}&apos; {e.team === "home" ? home : away}
                  {e.player ? ` — ${e.player}` : ""}
                </span>
                <span className="tabular-nums text-ink">{pct(e.prob_after)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function TeamScore({ name, score }: { name: string; score: number | null }) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <span className="text-sm font-bold">{name}</span>
      <span className="text-2xl font-semibold tabular-nums">{score ?? "–"}</span>
    </div>
  );
}
