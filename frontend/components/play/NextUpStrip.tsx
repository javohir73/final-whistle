"use client";

import Link from "next/link";
import { useMemo } from "react";
import { CompEyebrowChip } from "@/components/Eyebrow";
import { getUpcomingMatches } from "@/lib/api";
import { kickoffDate, kickoffTime, relativeDayLabel } from "@/lib/datetime";
import { pct, topOutcome } from "@/lib/format";
import { isLiveNow } from "@/lib/liveLabel";
import { COMPETITIONS, footballMatchHref, type CompetitionId } from "@/lib/sports";
import type { MatchSummary } from "@/lib/types";
import { useFetch } from "@/lib/useFetch";
import { useTimezone } from "@/lib/useTimezone";

/** The next `count` fixtures still worth picking: live now, or scheduled with
 *  a kickoff ahead (a "scheduled" row whose kickoff passed is status lag or a
 *  ghost, never "next up"), in kickoff order. */
export function nextFixtures(matches: MatchSummary[], count: number, now: number = Date.now()): MatchSummary[] {
  return matches
    .filter((m) => {
      if (isLiveNow(m)) return true;
      if (m.status !== "scheduled" || !m.kickoff_utc) return false;
      const kickoff = Date.parse(m.kickoff_utc);
      return !Number.isNaN(kickoff) && kickoff > now;
    })
    .sort((a, b) => (a.kickoff_utc ?? "").localeCompare(b.kickoff_utc ?? ""))
    .slice(0, count);
}

function modelCall(m: MatchSummary): string | null {
  const p = m.probabilities;
  if (!p) return null;
  const side = topOutcome(p);
  const value = side === "home" ? p.home_win : side === "away" ? p.away_win : p.draw;
  const who = side === "home" ? m.teams.home : side === "away" ? m.teams.away : "Draw";
  return `${who} ${pct(value)}`;
}

/** A compact "Next up" strip for the platform home: the next fixtures with
 *  the model's leading call, each a tap into the match's pick. One
 *  competition for now -- there is no cross-competition "next fixtures"
 *  endpoint, and /matches/upcoming returns a whole season per competition,
 *  so fanning out over every league would cost the home page three full
 *  season payloads for three rows. Client-side so the static home page stays
 *  static; renders nothing on error or an empty slate. */
export function NextUpStrip({ competition = "epl", count = 3 }: { competition?: CompetitionId; count?: number }) {
  const { tz } = useTimezone();
  const state = useFetch(() => getUpcomingMatches(competition), [competition]);
  const rows = useMemo(
    () => (state.status === "success" ? nextFixtures(state.data, count) : []),
    [state, count],
  );
  const config = COMPETITIONS[competition];

  if (state.status === "error") return null;
  if (state.status === "success" && rows.length === 0) return null;

  return (
    <section aria-labelledby="next-up-heading" className="mt-6">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CompEyebrowChip comp={competition} />
          <h2 id="next-up-heading" className="font-display text-label font-semibold uppercase tracking-wider text-muted">
            Next up · {config.label}
          </h2>
        </div>
        <Link href={`${config.basePath}/fixtures`} className="text-xs font-semibold text-lime-deep hover:underline">
          All fixtures →
        </Link>
      </div>
      {state.status === "loading" ? (
        <div className="grid gap-2 sm:grid-cols-3" aria-hidden>
          {Array.from({ length: count }, (_, i) => (
            <div key={i} className="skeleton h-[68px] rounded-xl" />
          ))}
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-3">
          {rows.map((m) => {
            const live = isLiveNow(m);
            const day = m.kickoff_utc ? relativeDayLabel(m.kickoff_utc, tz) ?? kickoffDate(m.kickoff_utc, tz) : null;
            const call = modelCall(m);
            return (
              <li key={m.match_id}>
                <Link
                  href={`${footballMatchHref(competition, m.match_id)}#pick`}
                  className="glass flex min-h-[68px] items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 transition hover:border-win/40"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-label font-semibold uppercase tracking-wide text-muted">
                      {live ? "Live" : day && m.kickoff_utc ? `${day} · ${kickoffTime(m.kickoff_utc, tz)}` : "Kickoff TBC"}
                    </span>
                    <span className="block truncate font-display text-sm font-bold">
                      {m.teams.home} v {m.teams.away}
                    </span>
                  </span>
                  {call ? (
                    <span className="shrink-0 text-right">
                      <span className="block text-note font-semibold uppercase tracking-wide text-muted">Model</span>
                      <span className="block text-sm font-bold tabular-nums text-lime-deep">{call}</span>
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
