"use client";

import { Card, CheckIcon, Chip } from "@/components/ui";
import { HeroTeam } from "@/components/nrl/GrandFinalCard";
import { isNrlLiveNow } from "@/lib/nrlLive";
import { expectedMarginLabel } from "@/lib/format";
import { nrlDayLabel, nrlTimeLabel, wholePct } from "@/lib/nrlDisplay";
import { cn } from "@/lib/utils";
import type { NrlMatch } from "@/lib/types";
import { useLiveMatch } from "./LiveMatchProvider";

/** The NRL match header (the football match page's hero pattern): status
 *  chip + round/venue/date line, both clubs with their crests, and the score
 *  (live from the shared feed, or final) or the kick-off in the centre.
 *
 *  The model's call shows here only when the page passes a prediction, and
 *  the page only does that once the match is past the point of tipping (the
 *  reveal rule, decided server-side) -- an open match reaches this component
 *  with `prediction: null`. */
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
  const p = match.prediction;
  const favoured = p && p.p_home !== p.p_away ? (p.p_home > p.p_away ? home : away) : null;
  const favouredProb = p ? Math.max(p.p_home, p.p_away) : null;
  // Post-match verdict: did the model's favoured side win? (A drawn game with
  // no draw lean counts as a miss, same as the football cards.)
  const called =
    isFinal && p && scoreHome != null && scoreAway != null
      ? (p.p_home > p.p_away && scoreHome > scoreAway) || (p.p_away > p.p_home && scoreAway > scoreHome)
      : null;
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

      {p && favoured && favouredProb != null ? (
        <div className="border-t border-line px-4 py-5 min-[900px]:px-7 min-[900px]:py-6">
          <div className="text-notes text-muted">{isFinal ? "The model" : "The model’s pre-match pick"}</div>
          <div className="text-h2 font-semibold text-ink">
            Picked {favoured} at {wholePct(favouredProb)}
          </div>
          {called != null ? (
            <div
              className={cn(
                "mt-2 inline-flex items-center gap-1.5 text-notes font-semibold",
                called ? "text-brand" : "text-miss",
              )}
            >
              {called ? <CheckIcon /> : null}
              {called ? "Called it" : "Missed — an upset"}
            </div>
          ) : p.expected_margin != null && !isLive ? (
            <div className="mt-2 text-notes text-muted">
              Expected margin: {expectedMarginLabel(p.expected_margin, home, away)}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
