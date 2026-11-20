"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { TeamBadge } from "@/components/TeamBadge";
import { Card } from "@/components/ui";
import { useTimezone } from "@/lib/useTimezone";
import { kickoffTimeLower } from "@/components/match/matchPageData";
import { liveLabel, liveLabelSpoken, penaltyTally } from "@/lib/liveLabel";
import { RESULT_PENDING, stoppedLabel, type MatchPhase } from "@/lib/matchStatus";
import { ordinal } from "@/lib/standingsRows";
import type { GoalEvent, MatchSummary } from "@/lib/types";
import type { StandingLine } from "@/components/match/matchPageData";

/** "Saturday 21 November" in the reader's zone. */
export function dayLong(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(
    new Date(iso),
  );
}

export interface HeroTeam {
  name: string;
  href: string | null;
  standing: StandingLine | null;
}

/** The match hero (direction G): eyebrow "Premier League · Saturday 21
 *  November · Venue", the two clubs with real crests either side of the
 *  kick-off time, the live score or the full-time score, and -- under a
 *  hairline -- the pick (`children`). It never shows the model's numbers:
 *  the centre slot is for real scores only. */
export function MatchHero({
  competitionLabel,
  home,
  away,
  kickoffUtc,
  venue,
  summary,
  phase,
  children,
}: {
  competitionLabel: string;
  home: HeroTeam;
  away: HeroTeam;
  kickoffUtc: string | null;
  venue: string | null;
  summary: MatchSummary | null;
  phase: MatchPhase;
  children?: ReactNode;
}) {
  const { tz } = useTimezone();
  const eyebrow = [competitionLabel, kickoffUtc ? dayLong(kickoffUtc, tz) : null, venue ?? "Venue to be confirmed"]
    .filter(Boolean)
    .join(" · ");
  const hasScore =
    (phase === "live" || phase === "finished" || phase === "stale") &&
    summary != null &&
    summary.score_home != null &&
    summary.score_away != null;
  const events =
    hasScore && summary
      ? (summary.goal_events ?? []).length + (summary.card_events ?? []).filter((c) => c.type === "red").length
      : 0;

  return (
    <Card
      aria-labelledby="match-title"
      className="flex flex-col items-center px-4 pb-7 pt-7 text-center min-[900px]:px-10 min-[900px]:pb-9 min-[900px]:pt-10"
    >
      <h1 id="match-title" className="sr-only">
        {home.name} v {away.name}
      </h1>
      <p className="text-notes font-medium text-muted">{eyebrow}</p>
      <div className="mt-6 grid w-full max-w-[880px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 min-[900px]:gap-x-8">
        <TeamBlock team={home} side="home" />
        <Centre summary={summary} phase={phase} hasScore={hasScore} kickoffUtc={kickoffUtc} tz={tz} home={home.name} away={away.name} />
        <TeamBlock team={away} side="away" />
      </div>
      {events > 0 && summary && (
        <div className="mt-4 grid w-full max-w-[880px] grid-cols-2 gap-x-6 text-notes text-muted">
          <ul className="text-right">{scorers(summary, "home")}</ul>
          <ul className="text-left">{scorers(summary, "away")}</ul>
        </div>
      )}
      {children}
    </Card>
  );
}

/** Goals and red cards for one side, in minute order. Yellow cards are left
 *  out (calm: they rarely matter after the match). */
function scorers(summary: MatchSummary, side: "home" | "away") {
  const goals = (summary.goal_events ?? [])
    .filter((g) => g.side === side)
    .map((g: GoalEvent) => ({
      minute: g.minute,
      label: `${g.player}${g.minute != null ? ` ${g.minute}′` : ""}${g.type === "penalty" ? " (pen)" : g.type === "own_goal" ? " (OG)" : ""}`,
    }));
  const reds = (summary.card_events ?? [])
    .filter((c) => c.side === side && c.type === "red")
    .map((c) => ({ minute: c.minute, label: `${c.player}${c.minute != null ? ` ${c.minute}′` : ""} (red card)` }));
  return [...goals, ...reds]
    .sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0))
    .map((e, i) => (
      <li key={i} className="tabular-nums">
        {e.label}
      </li>
    ));
}

function TeamBlock({ team, side }: { team: HeroTeam; side: "home" | "away" }) {
  const text = (
    <span className="min-w-0">
      <span className="block break-words text-[22px] font-semibold leading-[1.05] tracking-[-0.025em] text-ink [hyphens:auto] group-hover:underline group-hover:decoration-2 group-hover:underline-offset-[5px] min-[900px]:text-[40px]">
        {team.name}
      </span>
      {team.standing && (
        <span className="mt-1 block text-notes text-muted min-[900px]:text-base">
          {ordinal(team.standing.pos)} · {team.standing.points} {team.standing.points === 1 ? "point" : "points"}
        </span>
      )}
    </span>
  );
  const crest = <TeamBadge team={team.name} size={60} decorative />;
  const cls =
    side === "home"
      ? "group flex min-w-0 flex-col-reverse items-center gap-2 text-center no-underline min-[900px]:flex-row min-[900px]:justify-end min-[900px]:gap-[18px] min-[900px]:text-right"
      : "group flex min-w-0 flex-col items-center gap-2 text-center no-underline min-[900px]:flex-row min-[900px]:justify-start min-[900px]:gap-[18px] min-[900px]:text-left";
  const inner = side === "home" ? <>{text}{crest}</> : <>{crest}{text}</>;
  if (!team.href) return <div className={cls}>{inner}</div>;
  return (
    <Link href={team.href} className={cls}>
      {inner}
    </Link>
  );
}

function Centre({
  summary,
  phase,
  hasScore,
  kickoffUtc,
  tz,
  home,
  away,
}: {
  summary: MatchSummary | null;
  phase: MatchPhase;
  hasScore: boolean;
  kickoffUtc: string | null;
  tz: string;
  home: string;
  away: string;
}) {
  const stopped = stoppedLabel(summary?.status);
  if (hasScore && summary) {
    const label =
      phase === "finished" ? "Full time" : phase === "stale" ? RESULT_PENDING : liveLabel(summary) || "Live";
    const spoken = phase === "live" ? `Live, ${liveLabelSpoken(summary) || "in play"}` : label;
    const pens = penaltyTally(summary);
    const announce = `${phase === "live" ? "Live" : label}: ${home} ${summary.score_home}–${summary.score_away} ${away}`;
    return (
      <div className="whitespace-nowrap">
        {/* One polite region with the score and the phase, never the ticking minute. */}
        <p className="sr-only" role="status">
          {announce}
        </p>
        <div aria-hidden="true" className="text-[40px] font-semibold leading-none tracking-[-0.03em] text-ink tabular-nums min-[900px]:text-[60px]">
          {summary.score_home}
          <span className="mx-1.5 text-[0.6em] text-dash">–</span>
          {summary.score_away}
        </div>
        <div className={phase === "live" ? "mt-2 text-notes font-semibold text-brand" : "mt-2 text-notes text-muted"}>
          {phase === "live" ? (
            <>
              <span aria-hidden="true">Live · {label}</span>
              <span className="sr-only">{spoken}</span>
            </>
          ) : (
            label
          )}
        </div>
        {pens && <div className="mt-1 text-notes text-muted">{pens} on penalties</div>}
      </div>
    );
  }
  if (stopped && summary?.status !== "postponed") {
    return <div className="whitespace-nowrap text-[20px] font-semibold text-ink min-[900px]:text-[28px]">{stopped}</div>;
  }
  return (
    <div className="whitespace-nowrap text-[20px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink min-[900px]:text-[28px]">
      {kickoffUtc ? kickoffTimeLower(kickoffUtc, tz) : "TBC"}
      <small className="mt-1 block text-notes font-normal tracking-normal text-muted">
        {summary?.status === "postponed" ? "Postponed" : "kick-off"}
      </small>
    </div>
  );
}
