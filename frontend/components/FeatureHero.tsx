"use client";

import Link from "next/link";
import type { MatchSummary } from "@/lib/types";
import { COMPETITIONS, competitionLinks, footballMatchHref, type CompetitionId } from "@/lib/sports";
import { Eyebrow, CompEyebrowChip } from "@/components/Eyebrow";
import { ProbabilityBar } from "@/components/ProbabilityBar";
import { ClubBadge } from "@/components/ClubBadge";
import { TeamBadge } from "@/components/TeamBadge";
import { useRenderNow } from "@/components/match/clock";
import { hasMatchPagePick } from "@/components/match/picks";
import { formatScore, pctTriple, topOutcome } from "@/lib/format";
import { matchPhase, type MatchPhase } from "@/lib/matchStatus";
import { kickoffDate, kickoffTime, tzAbbrev } from "@/lib/datetime";
import { cn } from "@/lib/utils";

/** The "why" section's anchor on each sport's match page. */
const WHY_ANCHOR: Record<"football" | "nrl", string> = { football: "#why", nrl: "#model" };

/** The primary call to action, honest about where a pick can be made:
 *  - before kickoff, "Make your pick": the match page's #pick where it has one
 *    (club leagues' scored game, the World Cup's W/D/L), the NRL tips game for
 *    NRL (its match page has no pick), and a plain "Preview" where picks are
 *    not open (the Champions League);
 *  - live, "Live now" into the match centre (its pick is closed);
 *  - after the whistle, "Match centre".
 *  Null href: there is no page to go to (an NRL round still TBC). */
function primaryCta(
  comp: CompetitionId,
  phase: MatchPhase,
  target: string | null,
): { label: string; href: string | null } {
  if (phase === "live") return { label: "Live now", href: target };
  if (phase === "upcoming" || phase === "postponed") {
    if (COMPETITIONS[comp].sport === "nrl") {
      const play = competitionLinks(comp).picks;
      return { label: "Make your pick", href: target !== null ? play : null };
    }
    if (hasMatchPagePick(comp)) {
      return { label: "Make your pick", href: target !== null ? `${target}#pick` : null };
    }
    return { label: "Preview", href: target };
  }
  return { label: "Match centre", href: target };
}

/** The P1 confidence -> color mapping. MEDIUM is amber, so its word is printed
 *  at 12px bold (`text-xs font-bold`) to clear the "amber text only >= 12px
 *  bold" a11y rule; HIGH is lime, LOW muted. */
const CONFIDENCE: Record<
  NonNullable<MatchSummary["confidence"]>,
  { word: string; cls: string }
> = {
  High: { word: "HIGH", cls: "text-lime-deep" },
  Medium: { word: "MEDIUM", cls: "text-amber-ink" },
  Low: { word: "LOW", cls: "text-muted" },
};

/**
 * FeatureHero — the "tonight's feature" match on the home hub (design/Floodlight
 * Prototype.dc.html, Recon 3 Screen 1). A glass panel under a single-radial
 * `.floodlight-glow` wash: the leading side's win probability at display-hero
 * scale in lime, the thin W/D/L bar beneath it, and two equal CTAs into the
 * match page. The bar's printed-% aria-label is the accessible source of truth
 * for the decorative-scale giant number, so both read from the SAME probabilities
 * and never disagree. `match={null}` renders an honest placeholder -- never a
 * fabricated number.
 *
 * The `badge`/`href`/`margin` slots are additive, serializable seams for NRL:
 * `badge="club"` swaps the country crests for `ClubBadge` club marks, `href`
 * overrides (or, when `null`, drops) the football CTA target, and `margin`
 * (when there's no predicted score) prints the model's expected margin instead
 * of a scoreline in the caption. All three default to today's football behavior.
 */
export function FeatureHero({
  match,
  comp,
  tz,
  badge = "flag",
  href,
  margin,
  eyebrow = "Tonight's feature",
}: {
  match: MatchSummary | null;
  comp: CompetitionId;
  tz?: string;
  badge?: "flag" | "club";
  href?: string | null;
  margin?: number | null;
  eyebrow?: string;
}) {
  // The page's clock: null while hydrating cached HTML (the feed's own status
  // decides that first pass), the browser clock after.
  const now = useRenderNow();
  if (!match) {
    return (
      <section className="glass relative overflow-hidden rounded-[16px] p-6">
        <span aria-hidden className="floodlight-glow pointer-events-none absolute inset-0" />
        <p className="relative text-center text-sm text-muted">No featured match right now</p>
      </section>
    );
  }

  const { teams, probabilities, predicted_score, confidence } = match;
  const phase = matchPhase(match, now);
  const live = phase === "live";
  // Live matches promote the in-play probabilities (same idiom as the old
  // match-of-day card). The giant number is the bar's own sum-to-100 share for
  // the leading outcome, so the two can never disagree.
  const probs = (live && match.live_probabilities) || probabilities;
  const leader = probs ? topOutcome(probs) : null;
  const triple = probs ? pctTriple(probs) : null;
  const heroPct = triple && leader ? triple[leader] : null;
  const leaderLabel =
    leader === "home"
      ? `${teams.home} win`
      : leader === "away"
        ? `${teams.away} win`
        : leader === "draw"
          ? "Draw"
          : "";
  const conf = confidence ? CONFIDENCE[confidence] : null;
  // NRL callers pass their own (season/round/no) link, or drop it with `null`
  // (a fixture whose round is still TBC has no detail page). The default is the
  // competition-scoped football page -- never the legacy /match/<id>, which
  // 308s into the World Cup and soft-404s for club matches. A non-football
  // competition with no href gets no link rather than a guessed one.
  const sport = COMPETITIONS[comp].sport;
  const target =
    href !== undefined
      ? href
      : sport === "football"
        ? footballMatchHref(comp, match.match_id)
        : null;
  const cta = primaryCta(comp, phase, target);
  const kickoffLabel =
    match.kickoff_utc && tz
      ? `${kickoffDate(match.kickoff_utc, tz)} · ${kickoffTime(match.kickoff_utc, tz)} ${tzAbbrev(match.kickoff_utc, tz)}`.trim()
      : null;
  // The side the margin favours: leader by win probability, draw ignored.
  const favoured = (probs?.home_win ?? 0) >= (probs?.away_win ?? 0) ? teams.home : teams.away;

  return (
    <section className="glass fade-up relative overflow-hidden rounded-[16px] p-5">
      <span aria-hidden className="floodlight-glow pointer-events-none absolute inset-0" />
      <div className="relative">
        {/* Eyebrow row: league accent chip + lime "tonight's feature", with a
            quiet live/kickoff marker pushed to the right. */}
        <div className="flex items-center gap-2">
          <CompEyebrowChip comp={comp} />
          <Eyebrow tone="lime">{eyebrow}</Eyebrow>
          {live ? (
            <span className="ml-auto text-label font-bold uppercase tracking-wide text-loss-ink">Live</span>
          ) : kickoffLabel ? (
            // Date · time · zone: a bare "3:00 PM" on a "Next up" card days
            // away never said which day, or in whose zone.
            <span className="ml-auto text-label font-semibold tabular-nums text-muted">
              {kickoffLabel}
            </span>
          ) : null}
        </div>

        {/* Matchup: home crest 52px, Bricolage names (home / v away), away
            crest 38px at 90% opacity. */}
        <div className="mt-2.5 flex items-center gap-3.5">
          {badge === "club" ? (
            <ClubBadge name={teams.home} size={52} />
          ) : (
            <TeamBadge team={teams.home} size={52} />
          )}
          <div className="min-w-0 flex-1 font-display text-headline font-extrabold leading-none tracking-[-0.03em]">
            <span className="block truncate">{teams.home}</span>
            <span className="block truncate">
              <span className="text-sub text-muted">v</span> {teams.away}
            </span>
          </div>
          {badge === "club" ? (
            <ClubBadge name={teams.away} size={38} />
          ) : (
            <TeamBadge team={teams.away} size={38} className="opacity-90" />
          )}
        </div>

        {/* Giant win %: display-hero scale in lime, with a smaller % suffix and
            a two-line caption. */}
        <div className="mt-3.5 flex items-baseline gap-2.5">
          <span className="text-display-hero tabular-nums text-lime-deep">
            {heroPct ?? "—"}
            <span className="text-[0.5em]">%</span>
          </span>
          <span className="text-label font-semibold leading-relaxed text-muted">
            <span className="uppercase tracking-wide">{leaderLabel}</span>
            <br />
            Model most likely:{" "}
            {margin != null && !predicted_score
              ? `${favoured} by ${Math.abs(margin).toFixed(1)}`
              : formatScore(predicted_score?.home ?? null, predicted_score?.away ?? null)}
            {conf && (
              <>
                {" · "}
                <span className={cn("text-xs font-bold", conf.cls)}>{conf.word} CONFIDENCE</span>
              </>
            )}
          </span>
        </div>

        {/* Thin (7px) W/D/L bar. Its printed-% aria-label is the accessible
            source of truth for the giant number above. */}
        {probs && (
          <div className="mt-3">
            <ProbabilityBar
              probabilities={probs}
              homeLabel={teams.home}
              awayLabel={teams.away}
              size="hero"
              showLabels={false}
            />
          </div>
        )}

        {/* Two equal CTAs. The primary says what can actually be done (see
            primaryCta); the secondary opens the "why". Lime primary, outline
            secondary; both 44px tap targets. With no page to go to (an NRL
            round still TBC) they degrade to non-interactive labels rather than
            mis-navigating — the hero's analogue of MatchCard's plain card. */}
        <div className="mt-4 flex gap-2.5">
          {cta.href !== null ? (
            <Link
              href={cta.href}
              className="flex min-h-[44px] flex-1 items-center justify-center rounded-[12px] bg-win font-display text-sm font-semibold text-action-ink transition hover:brightness-[1.06]"
            >
              {cta.label}
            </Link>
          ) : (
            <span
              aria-disabled
              className="flex min-h-[44px] flex-1 cursor-default items-center justify-center rounded-[12px] bg-win font-display text-sm font-semibold text-action-ink opacity-disabled"
            >
              {cta.label}
            </span>
          )}
          {target !== null ? (
            <Link
              href={`${target}${WHY_ANCHOR[sport]}`}
              className="flex min-h-[44px] flex-1 items-center justify-center rounded-[12px] border border-border font-display text-sm font-semibold text-foreground transition hover:border-win hover:text-lime-deep"
            >
              {heroPct != null ? `Why ${heroPct}%?` : "See the prediction"}
            </Link>
          ) : (
            <span
              aria-disabled
              className="flex min-h-[44px] flex-1 cursor-default items-center justify-center rounded-[12px] border border-border font-display text-sm font-semibold text-foreground opacity-disabled"
            >
              {heroPct != null ? `Why ${heroPct}%?` : "See the prediction"}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
