"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getMovers } from "@/lib/api";
import type { Mover } from "@/lib/types";
import { ChanceChip } from "@/components/ChanceChip";
import { Sparkline } from "@/components/Sparkline";

/** Reader copy for market codes; falls back for future markets. */
export function marketLabel(market: string): string {
  switch (market) {
    case "make_knockout":
      return "to reach the knockouts";
    case "win_title":
      return "to win the Cup";
    case "qualify_group":
      return "to qualify from the group";
    case "win_match":
      return "to win this round";
    default:
      return "probability";
  }
}

/** "▲ 2.4" / "▼ 1.6" in percentage points; null with <2 snapshot days. */
export function formatDelta(delta: number | null): string | null {
  if (delta === null) return null;
  const pts = Math.abs(delta * 100).toFixed(1);
  return `${delta >= 0 ? "▲" : "▼"} ${pts}`;
}

/** A measured move that prints as "▲ 0.0" (formatDelta's one decimal of
 *  percentage points). A null delta is not flat -- it is a row with no
 *  history yet, still worth showing. */
function isFlat(delta: number | null): boolean {
  return delta !== null && Math.abs(delta * 100) < 0.05;
}

/** Home hero (replaces the "Your team" panel, spec 2026-07-09): the three
 *  biggest probability swings since the previous model refresh. Renders
 *  nothing when nothing moved -- an off-season feed (every delta 0) printed
 *  "Today's movers ▲ 0.0" on rows from a finished competition. */
export function MoversPanel({ sport }: { sport: "football" | "nrl" }) {
  const [movers, setMovers] = useState<Mover[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setMovers(null);
    setFailed(false);
    getMovers(sport)
      .then((res) => {
        if (active) setMovers(res.movers);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [sport]);

  if (failed || (movers !== null && (movers.length === 0 || movers.every((m) => isFlat(m.delta))))) {
    return null;
  }

  return (
    <section className="mt-6 rounded-card border border-line bg-ground px-4 py-5 min-[900px]:px-7 min-[900px]:py-6">
      <h2 className="text-h2 font-semibold text-ink">Today&apos;s movers</h2>
      {movers === null ? (
        <div className="skeleton mt-4 h-32 rounded-[10px]" aria-hidden="true" />
      ) : (
        <ul className="mt-2">
          {movers.map((m) => {
            const up = (m.delta ?? 0) >= 0;
            const rowInner = (
              <>
                <span className="flex-1">
                  <span className="font-semibold text-ink">
                    {m.name}
                  </span>
                  <span className="block text-label font-medium text-muted">
                    {marketLabel(m.market)}
                  </span>
                </span>
                <Sparkline values={m.series} tone={up ? "up" : "down"} />
                <ChanceChip
                  prob={m.prob}
                  deltaText={formatDelta(m.delta)}
                  tone={m.delta === null ? "muted" : up ? "up" : "down"}
                />
              </>
            );
            return (
              <li
                key={`${m.entity_id}-${m.market}`}
                className="flex items-center gap-3 border-t border-line-soft py-3 first:border-t-0"
              >
                {m.match_url ? (
                  <Link href={m.match_url} className="flex flex-1 items-center gap-3">
                    {rowInner}
                  </Link>
                ) : (
                  <div className="flex flex-1 items-center gap-3">{rowInner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Link
        href={sport === "nrl" ? "/nrl/matches" : "/matches"}
        className="mt-3 inline-block text-notes font-semibold text-brand underline-offset-[3px] hover:underline"
      >
        All fixtures
      </Link>
    </section>
  );
}
