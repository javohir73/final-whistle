"use client";

import { useCallback, useEffect, useState } from "react";
import { GoalMarkets } from "@/components/GoalMarkets";
import { MatchLineups } from "@/components/MatchLineups";
import { PremiumMarkets } from "@/components/PremiumMarkets";
import { useMatchLive } from "@/components/match/MatchLiveProvider";
import { MatchHero, type HeroTeam } from "@/components/match/MatchHero";
import { MatchPick } from "@/components/match/MatchPick";
import { ModelCallCard, type CallMode } from "@/components/match/ModelCallCard";
import { CallLoading, LockedCard, PendingCard, WhereTheyStand, WhyCard } from "@/components/match/MatchCards";
import { useModelData } from "@/components/match/useModelData";
import type { ModelData, Standing, StandingLine, WeekFixture } from "@/components/match/matchPageData";
import { BackLink, Card, CardHead, ChevronLeftIcon, ChevronRightIcon, RoundLink } from "@/components/ui";
import { getMatchLineups } from "@/lib/api";
import { matchPhase } from "@/lib/matchStatus";
import { isKnockout } from "@/lib/verdict";
import { competitionLinks, footballMatchHref, footballTeamHref, type CompetitionId } from "@/lib/sports";
import { useModelReveal } from "@/lib/useModelReveal";

export interface MatchViewProps {
  competition: CompetitionId;
  competitionLabel: string;
  matchId: number;
  home: string;
  away: string;
  homeTeamId: number | null;
  awayTeamId: number | null;
  kickoffUtc: string | null;
  venue: string | null;
  matchweek: number | null | undefined;
  /** The matchweek's fixtures in kick-off order ([] when there is none). */
  week: WeekFixture[];
  standing: Standing | null;
  /** The model's call -- ONLY when the fixture is public (kicked off,
   *  finished, or no pick game). Null for an open fixture: the client reads
   *  it after the viewer locks. */
  model: ModelData | null;
  /** The prediction exists (false for a just-drawn tie). */
  hasPrediction: boolean;
  /** What the hidden state may promise (no numbers). */
  hasReasons: boolean;
  hasGoalChances: boolean;
  back: { href: string; label: string };
}

/** The direction-G match page, below the frame: the top bar (back to the
 *  matchweek, "Match 3 of 10" with previous / next), the hero with the pick,
 *  then the model's call -- gated by the ONE reveal rule (lib/reveal.ts):
 *  an open fixture shows "Unlocked when you lock your pick" until this
 *  viewer's pick is locked; kicked off / finished / no pick game show it. */
export function MatchView(props: MatchViewProps) {
  const { competition, matchId, home, away, week, standing, model, hasPrediction } = props;
  const live = useMatchLive();
  const summary = live?.summary ?? null;
  const now = live?.now ?? null;
  const kickoff = summary?.kickoff_utc ?? props.kickoffUtc;
  const status = summary?.status ?? "scheduled";
  const phase = matchPhase({ status, kickoff_utc: kickoff ?? null }, now);
  const reveal = useModelReveal(
    { competition, matchId, status, kickoffUtc: kickoff, matchweek: props.matchweek ?? summary?.matchweek },
    { now },
  );
  const modelState = useModelData({
    matchId,
    competition,
    revealed: reveal.revealed,
    initial: model,
    hasPrediction,
  });
  const [justLocked, setJustLocked] = useState(false);
  const onLocked = useCallback(() => setJustLocked(true), []);
  const ready = modelState.kind === "ready" ? modelState.data : null;

  // After a lock, bring the revealed call into view (instantly under reduced motion).
  useEffect(() => {
    if (!justLocked || !ready) return;
    const el = document.getElementById("forecast");
    if (!el || typeof el.scrollIntoView !== "function") return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [justLocked, ready]);

  const links = competitionLinks(competition);
  const teamHref = (id: number | null) => (id != null ? footballTeamHref(competition, id) : null);
  const heroHome: HeroTeam = { name: home, href: teamHref(props.homeTeamId), standing: standing?.home ?? null };
  const heroAway: HeroTeam = { name: away, href: teamHref(props.awayTeamId), standing: standing?.away ?? null };

  const finished = phase === "finished";
  const result =
    finished && summary && summary.score_home != null && summary.score_away != null
      ? { home: summary.score_home_90 ?? summary.score_home, away: summary.score_away_90 ?? summary.score_away }
      : null;
  const mode: CallMode =
    finished ? "finished" : reveal.reason === "locked_pick" ? "locked" : reveal.reason === "no_pick_game" ? "open" : "made";
  const showDetail = mode === "locked" || mode === "open";

  const stand = standing ? (
    <WhereTheyStand
      standing={standing}
      teamHref={(r: StandingLine) => footballTeamHref(competition, r.teamId)}
      tableHref={links.table}
      tableLabel={links.table.endsWith("/groups") ? "All groups" : "Full table"}
    />
  ) : null;

  let below: React.ReactNode;
  if (!hasPrediction) {
    below = (
      <>
        <PendingCard />
        {stand}
      </>
    );
  } else if (!reveal.revealed) {
    const items = [
      "The model’s score",
      "Win, draw and loss chances",
      ...(props.hasReasons ? ["Why the model thinks so"] : []),
      ...(props.hasGoalChances ? ["Goal chances"] : []),
    ];
    if (items.length === 2) items.push("The model’s confidence");
    below = (
      <div className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(min(360px,100%),1fr))]">
        <LockedCard items={items} />
        {stand}
      </div>
    );
  } else if (!ready) {
    below = (
      <>
        <CallLoading onRetry={modelState.kind === "error" ? modelState.retry : undefined} />
        {stand}
      </>
    );
  } else {
    const why = showDetail && ready.reasons.length > 0 ? <WhyCard reasons={ready.reasons} /> : null;
    const goals = showDetail && ready.goalMarkets ? <GoalMarkets home={home} away={away} markets={ready.goalMarkets} /> : null;
    below = (
      <>
        <ModelCallCard
          home={home}
          away={away}
          data={ready}
          mode={mode}
          pick={reveal.pick}
          result={result}
          rise={justLocked}
          knockout={isKnockout(summary?.stage)}
        />
        {(why || goals) && (
          <div className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(min(360px,100%),1fr))]">
            {why}
            {goals}
          </div>
        )}
        {showDetail && (
          <PremiumMarkets matchId={matchId} home={home} away={away} competition={competition} returnTo={footballMatchHref(competition, matchId)} />
        )}
        {stand}
      </>
    );
  }

  const modelScore =
    ready && ready.predicted.home != null && ready.predicted.away != null
      ? { home: ready.predicted.home, away: ready.predicted.away }
      : null;

  return (
    <div>
      <TopBar competition={competition} matchId={matchId} week={week} back={props.back} />
      <MatchHero
        competitionLabel={props.competitionLabel}
        home={heroHome}
        away={heroAway}
        kickoffUtc={kickoff ?? null}
        venue={props.venue}
        summary={summary}
        phase={phase}
      >
        <MatchPick
          competition={competition}
          matchId={matchId}
          home={home}
          away={away}
          kickoffUtc={props.kickoffUtc}
          matchweek={props.matchweek}
          modelScore={modelScore}
          week={week}
          onLocked={onLocked}
        />
      </MatchHero>
      <div className="mt-6 flex flex-col gap-6">
        {below}
        <LineupsSection matchId={matchId} kickoffUtc={kickoff ?? null} phase={phase} />
      </div>
    </div>
  );
}

/** "‹ Matchweek 11" … "Match 7 of 10  ‹ ›". */
function TopBar({
  competition,
  matchId,
  week,
  back,
}: {
  competition: CompetitionId;
  matchId: number;
  week: WeekFixture[];
  back: { href: string; label: string };
}) {
  const i = week.findIndex((f) => f.id === matchId);
  const prev = i > 0 ? week[i - 1] : null;
  const next = i >= 0 && i < week.length - 1 ? week[i + 1] : null;
  return (
    <nav aria-label="Match navigation" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-5">
      <BackLink href={back.href}>{back.label}</BackLink>
      {i >= 0 && week.length > 1 && (
        <div className="flex items-center gap-3 text-muted">
          <span>
            Match {i + 1} of {week.length}
          </span>
          <RoundLink
            label={prev ? `Previous match: ${prev.home} v ${prev.away}` : "Previous match"}
            href={prev ? footballMatchHref(competition, prev.id) : back.href}
            disabled={!prev}
          >
            <ChevronLeftIcon size={16} />
          </RoundLink>
          <RoundLink
            label={next ? `Next match: ${next.home} v ${next.away}` : "Next match"}
            href={next ? footballMatchHref(competition, next.id) : back.href}
            disabled={!next}
          >
            <ChevronRightIcon size={16} />
          </RoundLink>
        </div>
      )}
    </nav>
  );
}

/** Official lineups, only once they can exist (from 90 minutes before
 *  kick-off) and only when the provider has them: the free feed has none, so
 *  this renders nothing at all rather than an empty shell. */
function LineupsSection({ matchId, kickoffUtc, phase }: { matchId: number; kickoffUtc: string | null; phase: string }) {
  const [available, setAvailable] = useState(false);
  const due =
    phase === "live" ||
    phase === "finished" ||
    phase === "stale" ||
    (kickoffUtc != null && Date.parse(kickoffUtc) - Date.now() < 90 * 60_000);
  useEffect(() => {
    if (!due) return;
    let alive = true;
    getMatchLineups(matchId)
      .then((d) => {
        if (alive) setAvailable(!!d?.available);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [due, matchId]);
  if (!available) return null;
  return (
    <section id="lineups" aria-labelledby="lineups-heading" className="scroll-mt-28">
      <Card pad>
        <CardHead id="lineups-heading" title="Lineups" />
        <div className="mt-4">
          <MatchLineups matchId={matchId} />
        </div>
      </Card>
    </section>
  );
}
