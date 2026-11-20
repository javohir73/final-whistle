"use client";

import { useEffect, useState } from "react";
import { Card, Chip } from "@/components/ui";
import { HeroTeam } from "@/components/nrl/GrandFinalCard";
import { CLIENT_BASE } from "@/lib/api";
import { isNrlLiveNow } from "@/lib/nrlLive";
import { nrlDayLabel, nrlTimeLabel } from "@/lib/nrlDisplay";
import type { NrlMatch, NrlMatchStatsResponse, NrlTryEventOut } from "@/lib/types";
import { useLiveMatch } from "./LiveMatchProvider";

export interface TryLine {
  player: string;
  /** "35′, 59′" */
  minutes: string;
}

/** One line per try scorer of a side ("Mark Nawaqanitawase" · "35′, 59′"),
 *  in the order the tries came. */
export function tryLines(events: NrlTryEventOut[], team: string): TryLine[] {
  const byPlayer = new Map<string, number[]>();
  for (const e of events) {
    if (e.team !== team) continue;
    byPlayer.set(e.player, [...(byPlayer.get(e.player) ?? []), e.minute]);
  }
  return Array.from(byPlayer, ([player, mins]) => ({ player, minutes: mins.map((m) => `${m}′`).join(", ") }));
}

/** The try scorers of a finished match, from /api/nrl/matches/{id}/stats
 *  (only finished, ingested matches have stats). Null until known or when
 *  there are none -- the hero then simply shows no list. */
function useTryScorers(
  matchId: number,
  finished: boolean,
  home: string,
  away: string,
): { home: TryLine[]; away: TryLine[] } | null {
  const [events, setEvents] = useState<NrlTryEventOut[] | null>(null);
  useEffect(() => {
    if (!finished) return;
    let cancelled = false;
    try {
      fetch(`${CLIENT_BASE}/api/nrl/matches/${matchId}/stats`, { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<NrlMatchStatsResponse>) : null))
        .then((body) => {
          if (!cancelled) setEvents(body?.try_timeline ?? null);
        })
        .catch(() => {});
    } catch {
      // No fetch (tests, very old browsers): no list.
    }
    return () => {
      cancelled = true;
    };
  }, [matchId, finished]);
  if (!events || events.length === 0) return null;
  const lines = { home: tryLines(events, home), away: tryLines(events, away) };
  return lines.home.length + lines.away.length > 0 ? lines : null;
}

/** The NRL match header (the football match page's hero pattern): status
 *  chip + round/venue/date line, both clubs with their crests, the score
 *  (live from the shared feed, or final) or the kick-off in the centre, and
 *  on a finished match the try scorers under each side (like the football
 *  hero's goal scorers). It never shows the model's numbers -- the model's
 *  call is its own card below, behind the reveal rule. */
export function NrlMatchHero({
  match,
  home,
  away,
  roundLabel,
}: {
  match: NrlMatch;
  home: string;
  away: string;
  roundLabel?: string;
}) {
  const state = useLiveMatch();
  const liveState = state.status === "success" ? state.data : null;
  const isFinal = liveState?.status === "final" || match.status === "finished";
  // Mutually exclusive with isFinal (a graded match row + a stale live row
  // must not stack LIVE over Full time), and bounded by the kickoff window
  // like every other NRL surface -- a poller that died mid-match leaves /live
  // answering "live" with a frozen minute indefinitely.
  const isLive = !isFinal && liveState?.status === "live" && isNrlLiveNow(match);
  const scoreHome = isLive || liveState?.status === "final" ? liveState.score_home : match.score_home;
  const scoreAway = isLive || liveState?.status === "final" ? liveState.score_away : match.score_away;
  const score = `${scoreHome ?? "–"}–${scoreAway ?? "–"}`;
  const tries = useTryScorers(match.id, match.status === "finished", home, away);
  const meta = [roundLabel, match.venue, match.kickoff_utc ? nrlDayLabel(match.kickoff_utc) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card flush aria-labelledby="nrl-match-heading">
      {/* One always-mounted live region carrying the SCORE, not just the badge.
          Screen readers announce content CHANGES inside an existing region --
          a region that mounts at kickoff is unreliably announced. Empty while
          not live, so it says nothing early. */}
      <p className="sr-only" role="status">
        {isLive
          ? `Live match: ${home} ${score} ${away}` + (liveState.minute != null ? `, ${liveState.minute}′` : "")
          : ""}
      </p>
      <div className="flex flex-col items-center px-4 pb-7 pt-7 text-center min-[900px]:px-10 min-[900px]:pb-9 min-[900px]:pt-10">
        <div className="flex flex-wrap items-center justify-center gap-2.5 text-notes font-medium text-muted">
          {isLive ? (
            <span aria-hidden="true">
              <Chip className="bg-ink text-white">LIVE{liveState.minute != null ? ` · ${liveState.minute}′` : ""}</Chip>
            </span>
          ) : isFinal ? (
            <Chip className="text-ink">Full time</Chip>
          ) : null}
          <span>{meta}</span>
        </div>
        <h1 id="nrl-match-heading" className="sr-only">
          {home} v {away}
        </h1>
        <div className="mt-6 grid w-full max-w-[880px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 min-[900px]:gap-x-8">
          <HeroTeam name={home} teamId={match.home_team_id ?? null} side="home" size={60} />
          {isLive || isFinal ? (
            <div className="whitespace-nowrap text-[40px] font-semibold leading-none tracking-[-0.03em] text-ink min-[900px]:text-[60px]">
              {score}
            </div>
          ) : (
            <div className="whitespace-nowrap text-[20px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink min-[900px]:text-[28px]">
              {nrlTimeLabel(match.kickoff_utc)}
            </div>
          )}
          <HeroTeam name={away} teamId={match.away_team_id ?? null} side="away" size={60} />
        </div>
      </div>

      {tries ? (
        <div className="-mt-3 grid grid-cols-2 gap-x-4 px-4 pb-7 text-label text-muted min-[900px]:gap-x-6 min-[900px]:text-notes min-[900px]:-mt-5 min-[900px]:px-10 min-[900px]:pb-9">
          <ul aria-label={`${home} tries`} className="text-right">
            {tries.home.map((t) => (
              <li key={t.player} className="tabular-nums">
                {t.player} <span className="whitespace-nowrap">{t.minutes}</span>
              </li>
            ))}
          </ul>
          <ul aria-label={`${away} tries`} className="text-left">
            {tries.away.map((t) => (
              <li key={t.player} className="tabular-nums">
                {t.player} <span className="whitespace-nowrap">{t.minutes}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
