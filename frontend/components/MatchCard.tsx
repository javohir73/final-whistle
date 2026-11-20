"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { MatchSummary } from "@/lib/types";
import { expectedMarginLabel, formatScore } from "@/lib/format";
import { liveLabel, liveLabelSpoken } from "@/lib/liveLabel";
import { predictionVerdict, type Verdict } from "@/lib/verdict";
import { ShootoutNote } from "@/components/ShootoutNote";
import { kickoffDate, kickoffTime } from "@/lib/datetime";
import { trackEvent } from "@/lib/analytics";
import { useFavorites } from "@/lib/useFavorites";
import { useRenderNow } from "@/components/match/clock";
import { ClubBadge } from "@/components/ClubBadge";
import { TeamBadge } from "@/components/TeamBadge";
import { Chip, type ChipTone } from "@/components/ui";
import { MODEL_HIDDEN_NOTE, revealDecision } from "@/lib/reveal";
import { asFootballCompetition, competitionInPathname, type CompetitionId } from "@/lib/sports";
import { useModelReveal, type ModelReveal } from "@/lib/useModelReveal";
import { cn } from "@/lib/utils";
import { RESULT_PENDING, matchPhase, showsKickoffCountdown, stoppedLabel } from "@/lib/matchStatus";

// One warning per page load, not one per row of a long list.
let warnedMissingHref = false;

/** Legacy fallback for callers that have not passed `href` yet. */
function legacyHref(matchId: number): string {
  if (!warnedMissingHref && process.env.NODE_ENV !== "production") {
    warnedMissingHref = true;
    console.warn(
      `MatchCard rendered without an href (match ${matchId}); falling back to /match/${matchId}. ` +
        "Pass footballMatchHref(competition, id) from lib/sports, an NRL href, or null.",
    );
  }
  return `/match/${matchId}`;
}

const VERDICT: Record<Verdict["kind"], { label: string; tone: ChipTone }> = {
  exact: { label: "Exact score", tone: "good" },
  winner: { label: "Right result", tone: "ok" },
  miss: { label: "Missed", tone: "miss" },
};

/** The competition whose pick game decides the reveal: the caller's, else
 *  the match's own field, else the one its link names. Null = unknown. */
function resolveCompetition(
  explicit: CompetitionId | undefined,
  match: MatchSummary,
  href: string | null,
): CompetitionId | null {
  return explicit ?? asFootballCompetition(match.competition) ?? (href ? competitionInPathname(href) : null);
}

/** A fixture card for lists (team pages, NRL rounds, timelines), in the
 *  direction-G style: a white card, real crests straight on white, names,
 *  kick-off or score -- and the model's call only where the reveal rule
 *  allows it (lib/reveal.ts): finished or kicked-off matches, competitions
 *  without a pick game, or an open fixture the viewer has LOCKED a pick on.
 *  Open fixtures otherwise say the call appears once you lock yours; the
 *  server HTML never carries a model number for them.
 *
 *  Props are unchanged from the previous card (`badge`, `href`, `margin`,
 *  `variant`, `showDate`, `tz`); `competition`, `season` and `round` are
 *  optional extras for callers whose matches do not carry their competition
 *  (an unknown competition fails CLOSED: hidden until kick-off). */
export function MatchCard({
  match,
  tz,
  showDate = false,
  variant = "full",
  badge = "flag",
  href,
  margin,
  competition,
  season,
  round,
}: {
  match: MatchSummary;
  tz?: string;
  showDate?: boolean;
  variant?: "full" | "compact";
  badge?: "flag" | "club";
  href?: string | null;
  margin?: number | null;
  competition?: CompetitionId;
  /** NRL: the round the fixture belongs to, so a submitted tip is found. */
  season?: number;
  round?: number;
}) {
  const { teams } = match;
  const now = useRenderNow();
  const phase = matchPhase(match, now);
  const live = phase === "live";
  const finished = phase === "finished";
  const stale = phase === "stale";
  const stopped = stoppedLabel(match.status);
  const target = href === undefined ? legacyHref(match.match_id) : href;

  const comp = resolveCompetition(competition, match, target);
  const hookReveal = useModelReveal(
    {
      competition: comp ?? "unknown",
      matchId: match.match_id,
      status: match.status,
      kickoffUtc: match.kickoff_utc,
      matchweek: match.matchweek,
      season,
      round,
    },
    { now },
  );
  // Unknown competition: status and clock alone decide, never "no pick game".
  const reveal: ModelReveal = comp
    ? hookReveal
    : {
        ...revealDecision({ status: match.status, kickoff: match.kickoff_utc, now, hasLockedPick: false }),
        pick: null,
        isLoading: false,
      };

  const kickoff =
    showsKickoffCountdown(match.status) && match.kickoff_utc && tz
      ? showDate
        ? `${kickoffDate(match.kickoff_utc, tz)} · ${kickoffTime(match.kickoff_utc, tz)}`
        : kickoffTime(match.kickoff_utc, tz)
      : null;
  const hasScore = match.score_home != null && match.score_away != null;
  const showScore = hasScore && (live || finished || stale);
  const verdict = finished ? predictionVerdict(match) : null;

  const status: ReactNode = live ? (
    <Chip aria-label={`Live, ${liveLabelSpoken(match)}`} className="bg-ink text-white">
      {liveLabel(match)}
    </Chip>
  ) : finished ? (
    <Chip>Full time</Chip>
  ) : stale ? (
    <Chip>{RESULT_PENDING}</Chip>
  ) : stopped ? (
    <Chip>{stopped}</Chip>
  ) : kickoff ? (
    <span className="text-label font-semibold tabular-nums text-ink">{kickoff}</span>
  ) : null;

  const model = <ModelLine match={match} reveal={reveal} margin={margin} verdict={verdict} finished={finished} />;

  const content =
    variant === "compact" ? (
      <div className="flex items-start gap-3">
        <span className="flex shrink-0 items-center gap-1 pt-0.5">
          <Crest name={teams.home} badge={badge} size={22} />
          <Crest name={teams.away} badge={badge} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="break-words font-semibold leading-snug text-ink">
            {teams.home} <span className="font-normal text-muted">v</span> {teams.away}
          </div>
          <div className="mt-0.5 text-label text-muted">
            {live ? liveLabel(match) : finished ? "Full time" : stale ? RESULT_PENDING : stopped ?? kickoff ?? "Kick-off TBC"}
            {" · "}
            {match.venue ?? "Venue TBC"}
          </div>
          <div className="mt-2">{model}</div>
        </div>
        {showScore && (
          <span className="shrink-0 rounded-[10px] bg-ink px-2.5 py-1 font-semibold tabular-nums text-white">
            {formatScore(match.score_home, match.score_away)}
          </span>
        )}
      </div>
    ) : (
      <>
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-label text-muted">{match.group ?? match.stage}</span>
          {status}
        </div>
        <div className="space-y-2.5">
          <TeamRow name={teams.home} score={showScore ? match.score_home : null} badge={badge} />
          <TeamRow name={teams.away} score={showScore ? match.score_away : null} badge={badge} />
        </div>
        <div className="mt-4 border-t border-line-soft pt-3">{model}</div>
      </>
    );

  const shell = cn(
    "block rounded-card border bg-ground text-ink no-underline",
    variant === "compact" ? "p-4" : "p-5",
    live ? "border-ink" : "border-line",
  );

  if (target === null) {
    return (
      <div className={shell} data-live={live || undefined}>
        {content}
      </div>
    );
  }
  return (
    <Link
      href={target}
      data-live={live || undefined}
      onClick={() => trackEvent("match_card_click", { match_id: match.match_id, href: target })}
      className={cn(shell, "transition-colors hover:border-line-strong")}
    >
      {content}
    </Link>
  );
}

function Crest({ name, badge, size }: { name: string; badge: "flag" | "club"; size: number }) {
  return badge === "club" ? (
    <ClubBadge name={name} size={size} decorative />
  ) : (
    <TeamBadge team={name} size={size} decorative />
  );
}

/** The model's part of the card, by the reveal rule. */
function ModelLine({
  match,
  reveal,
  margin,
  verdict,
  finished,
}: {
  match: MatchSummary;
  reveal: ModelReveal;
  margin?: number | null;
  verdict: Verdict | null;
  finished: boolean;
}) {
  const ps = match.predicted_score;
  const modelScore = ps && ps.home != null && ps.away != null ? formatScore(ps.home, ps.away) : null;
  const you = reveal.pick?.kind === "score" ? `${reveal.pick.home}–${reveal.pick.away}` : null;

  if (!reveal.revealed) {
    return (
      <p className="text-notes text-muted">
        {you ? (
          <>
            You <b className="font-bold text-brand">{you}</b>
          </>
        ) : (
          MODEL_HIDDEN_NOTE
        )}
      </p>
    );
  }
  const call = modelScore
    ? modelScore
    : margin != null && !finished
      ? expectedMarginLabel(margin, match.teams.home, match.teams.away)
      : null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-notes text-muted">
      {verdict && <Chip tone={VERDICT[verdict.kind].tone}>{VERDICT[verdict.kind].label}</Chip>}
      {you && (
        <span>
          You <b className="font-bold text-brand">{you}</b>
        </span>
      )}
      {call ? (
        <span>
          Model <b className="font-bold text-ink">{call}</b>
        </span>
      ) : (
        !verdict && <span>No model call for this match</span>
      )}
      {finished && <ShootoutNote verdict={verdict} />}
    </div>
  );
}

function TeamRow({ name, score, badge }: { name: string; score: number | null; badge: "flag" | "club" }) {
  return (
    <div className="flex items-center gap-3">
      <Crest name={name} badge={badge} size={24} />
      <span className="min-w-0 flex-1 break-words font-semibold leading-snug">{name}</span>
      {score != null && <span className="text-lg font-semibold tabular-nums">{score}</span>}
      <FavouriteMark team={name} />
    </div>
  );
}

/** A static mark for a favourited team. Deliberately not a button: this row
 *  sits inside the card's link. Favourites are toggled on the team page. */
function FavouriteMark({ team }: { team: string }) {
  const { isFavorite } = useFavorites();
  if (!isFavorite(team)) return null;
  return (
    <span className="text-sm leading-none text-brand">
      <span aria-hidden>★</span>
      <span className="sr-only">(favourite team)</span>
    </span>
  );
}
