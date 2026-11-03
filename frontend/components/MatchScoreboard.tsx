"use client";

import { useTimezone } from "@/lib/useTimezone";
import { kickoffDate, kickoffTime, tzAbbrev } from "@/lib/datetime";
import { formatScore } from "@/lib/format";
import { liveLabel, liveLabelSpoken, penaltyTally } from "@/lib/liveLabel";
import { predictionVerdict } from "@/lib/verdict";
import { matchPhase, stoppedLabel, type MatchPhase } from "@/lib/matchStatus";
import type { KnockoutAdvance, MatchSummary, PredictedScore, Probabilities, GoalEvent, CardEvent } from "@/lib/types";
import { Scorebug, type ScorebugStatus } from "@/components/Scorebug";
import { ModelCall } from "@/components/match/ModelCall";
import { MatchLiveProvider, useMatchLive, type MatchLive } from "@/components/match/MatchLiveProvider";
import { COMPETITIONS, type CompetitionId } from "@/lib/sports";

interface Props {
  matchId: number;
  /** Tournament / competition name shown in the Scorebug eyebrow. */
  competitionLabel?: string;
  home: string;
  away: string;
  homeTeamId?: number | null;
  awayTeamId?: number | null;
  /** Kickoff (UTC ISO) + venue — build the Scorebug's pre-match status line. */
  kickoffUtc?: string | null;
  venue?: string | null;
  /** The model's pre-match call; null while the prediction is still being
   *  generated (a just-drawn tie), which renders an honest "on the way" note
   *  in place of the call -- same hero, same pick below it. */
  probabilities: Probabilities | null;
  predicted: PredictedScore | null;
  initialSummary?: MatchSummary | null;
  confidence?: string | null;
  /** Knockout resolution block (v0.5) — who goes through, past the 90th minute. */
  knockout?: KnockoutAdvance | null;
  competition?: CompetitionId;
  /** The server's render instant (ISO), for the feed this hero provides
   *  itself when rendered outside a MatchLiveProvider: hydration then reads
   *  the server's clock first. Ignored inside a provider (it owns the clock). */
  serverNow?: string | null;
}

/** The match hero: ONE card holding the broadcast Scorebug (status line,
 *  crests, "vs" or the real score, names), the goal/card timeline once there
 *  is a score, and the model's call (one sentence, one labelled bar, a
 *  most-likely-score chip and the confidence tier). Nothing in it repeats
 *  further down the page.
 *
 *  Status comes from matchPhase over the page's shared live feed
 *  (MatchLiveProvider), so the hero and the pick flip together: LIVE only while
 *  the feed says in_play inside the live window, FULL TIME only when the feed
 *  confirms it, "Result pending" -- with no verdict -- when the feed stopped
 *  short. Rendered without a provider (tests, isolated use) it provides its
 *  own feed. */
export function MatchScoreboard(props: Props) {
  const live = useMatchLive();
  if (live) return <MatchHero {...props} live={live} />;
  return (
    <MatchLiveProvider
      matchId={props.matchId}
      competition={props.competition}
      kickoffUtc={props.kickoffUtc}
      initialSummary={props.initialSummary}
      serverNow={props.serverNow}
    >
      <MatchScoreboard {...props} />
    </MatchLiveProvider>
  );
}

function MatchHero({
  competitionLabel = "Match",
  home,
  away,
  homeTeamId,
  awayTeamId,
  kickoffUtc,
  venue,
  probabilities,
  predicted,
  confidence,
  knockout,
  competition,
  live,
}: Props & { live: MatchLive }) {
  const { tz } = useTimezone();
  const summary = live.summary;
  // Without a summary (its fetch failed) all we know is the scheduled kickoff;
  // matchPhase still turns a long-past one into "pending", never "upcoming".
  const phase: MatchPhase = matchPhase(
    summary ?? { status: "scheduled", kickoff_utc: kickoffUtc ?? null },
    live.now,
  );
  const isLive = phase === "live";
  const hasActual =
    (isLive || phase === "finished" || phase === "stale") &&
    summary != null && summary.score_home != null && summary.score_away != null;
  // Graded only on a feed-confirmed result.
  const verdict = phase === "finished" && summary ? predictionVerdict(summary) : null;
  const liveProbs = isLive ? summary?.live_probabilities ?? null : null;
  // During a live knockout shootout the centre stays on the level 90'/ET score
  // (e.g. 1–1); the running spot-kick tally is the decisive number. Null
  // outside a shootout — penaltyTally guards on the penalty fields.
  const shootoutTally = isLive && summary ? penaltyTally(summary) : null;

  // Pre-match status line: "Sat 20 Jun · 8:00 PM BST · venue". The date and
  // zone keep a fixture weeks out unambiguous; each segment is guarded so a
  // missing time or venue collapses without a stray dot (tzAbbrev can be "").
  const kickoffIso = summary?.kickoff_utc ?? kickoffUtc ?? null;
  const kickoff = kickoffIso
    ? `${kickoffDate(kickoffIso, tz)} · ${kickoffTime(kickoffIso, tz)} ${tzAbbrev(kickoffIso, tz)}`.trim()
    : null;
  // A deliberately stopped fixture says so, ahead of the (real, original) date.
  const stopped = stoppedLabel(summary?.status);
  const statusLine = [stopped, kickoff, venue].filter(Boolean).join(" · ") || null;
  const scorebugStatus: ScorebugStatus = isLive
    ? "live"
    : phase === "finished"
      ? "ft"
      : phase === "stale"
        ? "stale"
        : "upcoming";

  return (
    <section aria-label={`${home} vs ${away}`} className="glass overflow-hidden rounded-2xl">
      <Scorebug
        competitionLabel={competitionLabel}
        home={home}
        away={away}
        homeTeamId={homeTeamId}
        awayTeamId={awayTeamId}
        status={scorebugStatus}
        liveLabel={isLive && summary ? liveLabel(summary) : null}
        liveLabelSpoken={isLive && summary ? liveLabelSpoken(summary) : null}
        livePeriod={isLive ? summary?.period ?? null : null}
        statusLine={statusLine}
        venue={venue}
        score={hasActual ? formatScore(summary!.score_home, summary!.score_away) : null}
        penaltyTally={shootoutTally}
        teamBasePath={competition ? `${COMPETITIONS[competition].basePath}/team` : "/team"}
      />

      {hasActual &&
        (timelineFor(summary!, "home").length > 0 ||
          timelineFor(summary!, "away").length > 0 ||
          yellowCount(summary!, "home") > 0 ||
          yellowCount(summary!, "away") > 0) && (
        <div className="grid grid-cols-2 gap-x-4 border-b border-border px-5 py-3 text-label text-muted sm:text-xs">
          <ul className="space-y-0.5 text-right">
            {timelineFor(summary!, "home").map((label, i) => (
              <li key={`h-${i}`} className="tabular-nums">{label}</li>
            ))}
            {yellowCount(summary!, "home") > 0 && (
              <li className="tabular-nums" aria-label="home yellow cards">
                🟨 ×{yellowCount(summary!, "home")}
              </li>
            )}
          </ul>
          <ul className="space-y-0.5 text-left">
            {timelineFor(summary!, "away").map((label, i) => (
              <li key={`a-${i}`} className="tabular-nums">{label}</li>
            ))}
            {yellowCount(summary!, "away") > 0 && (
              <li className="tabular-nums" aria-label="away yellow cards">
                🟨 ×{yellowCount(summary!, "away")}
              </li>
            )}
          </ul>
        </div>
      )}

      {probabilities && predicted ? (
        <ModelCall
          home={home}
          away={away}
          probabilities={probabilities}
          liveProbabilities={liveProbs}
          predicted={predicted}
          confidence={confidence ?? null}
          phase={phase}
          hasActual={hasActual}
          knockout={knockout}
          stage={summary?.stage ?? null}
          verdict={verdict}
        />
      ) : (
        <div className="px-5 pb-5 pt-4 text-center">
          <h2 className="font-display text-base font-bold text-foreground">Model prediction on the way</h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted">
            The model generates this match&apos;s prediction shortly after both teams are
            confirmed. Check back soon for the full breakdown.
          </p>
        </div>
      )}
    </section>
  );
}

function formatScorer(g: GoalEvent): string {
  const annot = g.type === "penalty" ? " (pen)" : g.type === "own_goal" ? " (OG)" : "";
  const min = g.minute != null ? ` ${g.minute}'` : "";
  return `${g.player}${min}${annot}`;
}

/** Goals and red cards for one side, merged into one minute-ordered timeline.
 *  Yellows stay out of the timeline (rendered as a compact count instead). */
function timelineFor(s: MatchSummary, side: "home" | "away"): string[] {
  const goals = s.goal_events
    .filter((g) => g.side === side)
    .map((g) => ({ minute: g.minute, label: formatScorer(g) }));
  const reds = (s.card_events ?? [])
    .filter((c) => c.side === side && c.type === "red")
    .map((c) => ({ minute: c.minute, label: formatRedCard(c) }));
  return [...goals, ...reds]
    .sort((x, y) => (x.minute ?? 0) - (y.minute ?? 0))
    .map((e) => e.label);
}

function formatRedCard(c: CardEvent): string {
  const min = c.minute != null ? ` ${c.minute}'` : "";
  return `🟥 ${c.player}${min}`;
}

function yellowCount(s: MatchSummary, side: "home" | "away"): number {
  return (s.card_events ?? []).filter((c) => c.side === side && c.type === "yellow").length;
}
