"use client";

import type { MatchSummary } from "@/lib/types";
import { COMPETITIONS, competitionLinks, footballMatchHref, type CompetitionId } from "@/lib/sports";
import { ClubBadge } from "@/components/ClubBadge";
import { TeamBadge } from "@/components/TeamBadge";
import { useRenderNow } from "@/components/match/clock";
import { hasMatchPagePick } from "@/components/match/picks";
import { Button, Card, Chip, GhostButton, KickoffBox, Note, ScoreBox } from "@/components/ui";
import { formatScore, pctTriple, topOutcome } from "@/lib/format";
import { liveLabel } from "@/lib/liveLabel";
import { matchPhase, type MatchPhase } from "@/lib/matchStatus";
import { kickoffDate, kickoffTime, tzAbbrev } from "@/lib/datetime";
import { MODEL_HIDDEN_NOTE } from "@/lib/reveal";
import { useModelReveal } from "@/lib/useModelReveal";

/** The "why" section's anchor on each sport's match page. */
const WHY_ANCHOR: Record<"football" | "nrl", string> = { football: "#why", nrl: "#model" };

/** The primary call to action, honest about where a pick can be made:
 *  before kickoff "Make your pick" (the match page's #pick for club leagues
 *  and the World Cup, the tips game for NRL, a plain "Preview" where picks
 *  are not open -- the Champions League); live "Live now"; after the whistle
 *  "Match centre". Null href: there is no page to go to. */
function primaryCta(
  comp: CompetitionId,
  phase: MatchPhase,
  target: string | null,
): { label: string; href: string | null } {
  if (phase === "live") return { label: "Live now", href: target };
  if (phase === "upcoming" || phase === "postponed") {
    if (COMPETITIONS[comp].sport === "nrl") {
      return { label: "Make your pick", href: target !== null ? competitionLinks(comp).picks : null };
    }
    if (hasMatchPagePick(comp)) {
      return { label: "Make your pick", href: target !== null ? `${target}#pick` : null };
    }
    return { label: "Preview", href: target };
  }
  return { label: "Match centre", href: target };
}

/**
 * FeatureHero -- one featured match as a calm direction-G card: the two
 * sides with real crests, kick-off (or the score), and a clear next step.
 *
 * Reveal rule (lib/reveal.ts): the model's call -- its scoreline, its
 * leading chance, the expected margin -- shows only once the match has
 * kicked off, in a competition without a pick game, or after the viewer
 * LOCKED a pick for it. Before that the card says the call appears once you
 * lock yours; the server HTML never carries it. `match={null}` renders an
 * honest placeholder.
 *
 * Props unchanged (`badge`, `href`, `margin`, `eyebrow`); `season`/`round`
 * let NRL callers point the reveal at the right tips round.
 */
export function FeatureHero({
  match,
  comp,
  tz,
  badge = "flag",
  href,
  margin,
  eyebrow = "Next up",
  season,
  round,
}: {
  match: MatchSummary | null;
  comp: CompetitionId;
  tz?: string;
  badge?: "flag" | "club";
  href?: string | null;
  margin?: number | null;
  eyebrow?: string;
  season?: number;
  round?: number;
}) {
  const now = useRenderNow();
  const reveal = useModelReveal(
    {
      competition: comp,
      matchId: match?.match_id ?? -1,
      status: match?.status,
      kickoffUtc: match?.kickoff_utc,
      matchweek: match?.matchweek,
      season,
      round,
    },
    { now },
  );
  if (!match) {
    return (
      <Card pad>
        <Note className="text-center">No featured match right now</Note>
      </Card>
    );
  }

  const { teams } = match;
  const phase = matchPhase(match, now);
  const live = phase === "live";
  const sport = COMPETITIONS[comp].sport;
  const target =
    href !== undefined ? href : sport === "football" ? footballMatchHref(comp, match.match_id) : null;
  const cta = primaryCta(comp, phase, target);
  const kickoffLabel =
    match.kickoff_utc && tz
      ? `${kickoffDate(match.kickoff_utc, tz)} · ${kickoffTime(match.kickoff_utc, tz)} ${tzAbbrev(match.kickoff_utc, tz)}`.trim()
      : null;
  const hasScore = match.score_home != null && match.score_away != null && phase !== "upcoming";

  // The model's call, only once revealed.
  const probs = (live && match.live_probabilities) || match.probabilities;
  const leader = probs ? topOutcome(probs) : null;
  const triple = probs ? pctTriple(probs) : null;
  const leadPct = triple && leader ? triple[leader] : null;
  const leadLabel = leader === "home" ? `${teams.home} win` : leader === "away" ? `${teams.away} win` : "Draw";
  const ps = match.predicted_score;
  const favoured = (probs?.home_win ?? 0) >= (probs?.away_win ?? 0) ? teams.home : teams.away;
  const modelCall =
    ps && ps.home != null && ps.away != null
      ? formatScore(ps.home, ps.away)
      : margin != null
        ? `${favoured} by ${Math.abs(margin).toFixed(1)}`
        : null;
  const you = reveal.pick?.kind === "score" ? `${reveal.pick.home}–${reveal.pick.away}` : null;

  const crest = (name: string) =>
    badge === "club" ? <ClubBadge name={name} size={48} decorative /> : <TeamBadge team={name} size={48} decorative />;

  return (
    <Card pad aria-label={`${eyebrow}: ${teams.home} v ${teams.away}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-notes text-muted">
        <span className="font-medium">{eyebrow}</span>
        {live ? <Chip className="bg-ink text-white">Live · {liveLabel(match)}</Chip> : kickoffLabel && <span>{kickoffLabel}</span>}
      </div>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 min-[900px]:gap-5">
        <div className="flex min-w-0 flex-col items-center gap-2 text-center min-[900px]:flex-row-reverse min-[900px]:justify-start min-[900px]:text-right">
          {crest(teams.home)}
          <span className="min-w-0 break-words text-h2 font-semibold leading-snug">{teams.home}</span>
        </div>
        {hasScore ? (
          <ScoreBox home={match.score_home!} away={match.score_away!} />
        ) : (
          <KickoffBox>{match.kickoff_utc && tz ? kickoffTime(match.kickoff_utc, tz) : "v"}</KickoffBox>
        )}
        <div className="flex min-w-0 flex-col items-center gap-2 text-center min-[900px]:flex-row min-[900px]:text-left">
          {crest(teams.away)}
          <span className="min-w-0 break-words text-h2 font-semibold leading-snug">{teams.away}</span>
        </div>
      </div>

      <div className="mt-5 border-t border-line-soft pt-4 text-center">
        {reveal.revealed ? (
          <p className="fw-rise text-notes text-muted">
            {you && (
              <>
                You <b className="text-base font-bold text-brand">{you}</b>
                {" · "}
              </>
            )}
            {modelCall && (
              <>
                Model <b className="text-base font-bold text-ink">{modelCall}</b>
              </>
            )}
            {leadPct != null && (
              <>
                {modelCall ? " · " : ""}
                {leadLabel} {leadPct}%
              </>
            )}
          </p>
        ) : (
          <Note>{MODEL_HIDDEN_NOTE}</Note>
        )}
      </div>

      <div className="mt-4 flex flex-wrap justify-center gap-3">
        <Button href={cta.href ?? undefined} disabled={cta.href === null}>
          {cta.label}
        </Button>
        {reveal.revealed && (
          <GhostButton href={target !== null ? `${target}${WHY_ANCHOR[sport]}` : undefined} disabled={target === null}>
            Why the model thinks so
          </GhostButton>
        )}
      </div>
    </Card>
  );
}
