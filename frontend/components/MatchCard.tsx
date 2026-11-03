"use client";

import Link from "next/link";
import type { MatchSummary } from "@/lib/types";
import { expectedMarginLabel, formatScore, pctTriple, topOutcome } from "@/lib/format";
import { liveLabel, liveLabelSpoken } from "@/lib/liveLabel";
import { predictionVerdict, prematchCall } from "@/lib/verdict";
import { ShootoutNote, BasisTag } from "@/components/ShootoutNote";
import { kickoffDate, kickoffTime } from "@/lib/datetime";
import { trackEvent } from "@/lib/analytics";
import { useFavorites } from "@/lib/useFavorites";
import { useRenderNow } from "@/components/match/clock";
import { ProbabilityBar } from "./ProbabilityBar";
import { ClubBadge } from "@/components/ClubBadge";
import { TeamBadge } from "@/components/TeamBadge";
import {
  matchPhase,
  RESULT_PENDING,
  showsKickoffCountdown,
  stoppedLabel,
  willBePlayed,
} from "@/lib/matchStatus";

// One warning per page load, not one per row of a 380-fixture list.
let warnedMissingHref = false;

/** Legacy fallback for callers that have not passed `href` yet. `/match/<id>`
 *  only resolves for a club match once the competition lookup route lands, so
 *  every caller should pass `footballMatchHref(comp, id)` (or an NRL href, or
 *  null). Optional-but-logged for one release; make `href` required after. */
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

/** The core dashboard card: matchup, predicted winner, W/D/L bar, score.
 *  The status pill (top-right) carries the time/state: an amber kickoff-time
 *  pill before kickoff, a rose live-minute pill in play, a muted "Full time"
 *  pill once over. When `tz` is given the kickoff time is shown in the user's
 *  local timezone. Set `showDate` when the card isn't inside a day-grouped list
 *  (e.g. the personalized country hub) so the local date leads the time pill.
 *
 *  `variant="compact"` swaps the scoreboard body for the Floodlight "also
 *  on"/timeline row (design/Floodlight Prototype.dc.html): one line of team
 *  names, a time · venue sub-line, a lead percentage, and a labels-off
 *  probability bar -- no footer, for dense lists (home "also on", the Matches
 *  timeline). Default `"full"` is today's layout, unchanged in substance.
 *
 *  The `badge`/`href`/`margin` slots are serializable seams so NRL callers
 *  (several of them server components) can render this same card without
 *  forking a variant: `badge="club"` swaps the country crest for a `ClubBadge`
 *  club crest, `href` is the card's link (`null` drops it), and `margin` prints
 *  the model's expected margin chip.
 *
 *  `href` should always be passed (football: `footballMatchHref(comp, id)`).
 *  The old `/match/<id>` default 308'd into the World Cup and landed every club
 *  match on a soft 404; it survives one release as a logged fallback.
 *
 *  Status comes from matchPhase: FULL TIME only when the feed confirms it, a
 *  stranded in_play (or long-overdue scheduled) row reads "Result pending" with
 *  its last known score and no verdict. Nothing interactive sits inside the
 *  card link -- a favourited team shows a static star; the toggle lives on the
 *  team page. */
export function MatchCard({
  match,
  tz,
  showDate = false,
  variant = "full",
  badge = "flag",
  href,
  margin,
}: {
  match: MatchSummary;
  tz?: string;
  showDate?: boolean;
  variant?: "full" | "compact";
  badge?: "flag" | "club";
  href?: string | null;
  margin?: number | null;
}) {
  const { teams, probabilities, predicted_score, predicted_winner } = match;
  // The list's clock (its server render instant while hydrating cached HTML),
  // or the browser clock; null while hydrating without one -- the feed's own
  // status decides that first pass, the time bounds apply one commit later.
  const now = useRenderNow();
  const phase = matchPhase(match, now);
  const live = phase === "live";
  // Only a feed-confirmed result is "finished". A row the feed left stuck
  // (in_play past the live window, or scheduled long after kickoff) is
  // "stale": its last score shows, but nothing calls it full time.
  const finished = phase === "finished";
  const stale = phase === "stale";
  const stopped = stoppedLabel(match.status);
  const showPrediction = willBePlayed(match.status);
  const hasScore = match.score_home != null && match.score_away != null;
  const verdict = predictionVerdict(match);
  const call = prematchCall(probabilities, teams);
  const kickoffPill =
    showsKickoffCountdown(match.status) && match.kickoff_utc && tz
      ? showDate
        ? `${kickoffDate(match.kickoff_utc, tz)} · ${kickoffTime(match.kickoff_utc, tz)}`
        : kickoffTime(match.kickoff_utc, tz)
      : null;

  // `null` drops the link (the plain-card fallback used when an NRL round is
  // still unknown); `undefined` is a caller that predates required hrefs.
  const target = href === undefined ? legacyHref(match.match_id) : href;
  const shell = `glass group block rounded-[14px] ${variant === "compact" ? "p-3" : "p-4"} ${
    live ? "ring-1 ring-loss/40" : ""
  }`;

  const content =
    variant === "compact" ? (
      <CompactRow
        match={match}
        live={live}
        finished={finished}
        stale={stale}
        kickoffPill={kickoffPill}
        badge={badge}
        margin={margin}
        stopped={stopped}
        showPrediction={showPrediction}
      />
    ) : (
        <>
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="font-display text-label font-semibold uppercase tracking-wider text-muted">
              {match.group ?? match.stage}
            </span>
            {live ? (
              <span
                className="status-live-ring inline-flex items-center gap-1.5 rounded-full bg-loss/15 px-2 py-0.5 text-label font-bold uppercase tracking-wide text-loss-wash-ink"
                aria-label={`Live, ${liveLabelSpoken(match)}`}
              >
                <span className="status-live-dot h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                {liveLabel(match)}
              </span>
            ) : finished ? (
              <span className="rounded-full bg-surface-2/70 px-2 py-0.5 text-label font-bold uppercase tracking-wide text-muted">
                Full time
              </span>
            ) : stale ? (
              <span className="rounded-full bg-surface-2/70 px-2 py-0.5 text-label font-bold uppercase tracking-wide text-muted">
                {RESULT_PENDING}
              </span>
            ) : stopped ? (
              <span className="rounded-full bg-surface-2/70 px-2 py-0.5 text-label font-bold uppercase tracking-wide text-muted">
                {stopped}
              </span>
            ) : (
              kickoffPill && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-draw/15 px-2 py-0.5 text-label font-bold tabular-nums text-amber-ink">
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" strokeLinecap="round" />
                  </svg>
                  {kickoffPill}
                </span>
              )
            )}
          </div>

          <div className="mb-4 space-y-2.5">
            <TeamRow name={teams.home} score={hasScore ? match.score_home : null} live={live || finished || stale} badge={badge} />
            <TeamRow name={teams.away} score={hasScore ? match.score_away : null} live={live || finished || stale} badge={badge} />
          </div>

          {showPrediction && probabilities ? (
            <ProbabilityBar
              probabilities={probabilities}
              homeLabel={teams.home}
              awayLabel={teams.away}
            />
          ) : (
            <p className="text-sm text-muted">Prediction pending…</p>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
            {finished && verdict ? (
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                  verdict.kind === "miss" ? "text-loss-ink" : "text-lime-deep"
                }`}
              >
                <span aria-hidden>{verdict.kind === "miss" ? "✕" : "✓"}</span>
                {verdict.kind === "miss"
                  ? "Upset — we missed it"
                  : verdict.kind === "exact"
                    ? "Exact score!"
                    : "Called it"}
                <BasisTag verdict={verdict} />
              </span>
            ) : stale ? (
              // No verdict on an unconfirmed result -- the model is graded
              // only on a score the feed has actually called final.
              <span className="text-xs font-semibold text-muted">Awaiting the confirmed result</span>
            ) : showPrediction && call ? (
              <span
                className={`text-xs font-semibold ${
                  call.tone === "draw" ? "text-draw" : "text-lime-deep"
                }`}
              >
                {call.label}
              </span>
            ) : (
              <span className="text-muted">
                Winner{" "}
                <strong className="font-semibold text-foreground">
                  {predicted_winner ?? "—"}
                </strong>
              </span>
            )}
            {showPrediction && predicted_score ? (
              <span className="inline-flex items-center rounded-md bg-surface-2 px-2 py-0.5 font-display text-sm font-bold tabular-nums text-foreground">
                <span className="mr-1.5 align-middle text-note font-semibold uppercase tracking-wide text-muted">
                  Model
                </span>
                {formatScore(predicted_score.home, predicted_score.away)}
              </span>
            ) : (
              // NRL fixtures carry an expected margin, not a scoreline; the chip
              // stands in for the predicted-score slot on non-finished matches.
              // Read out as the favoured side ("Sharks by 4.0") — a signed
              // "margin -4.0" assumed the reader knows home-minus-away.
              showPrediction &&
              margin != null &&
              !finished && (
                <span className="rounded-lg bg-surface-2 px-2 py-0.5 font-bold tabular-nums text-foreground">
                  <span className="mr-1 font-semibold text-muted">Model</span>
                  {expectedMarginLabel(margin, teams.home, teams.away)}
                </span>
              )
            )}
            {finished && <ShootoutNote verdict={verdict} />}
          </div>
        </>
      );

  // A non-null target is the linked card; `null` drops the anchor entirely (a
  // plain glass card minus the hover affordance) — the NRL fixture-card
  // fallback when the round is still TBC.
  if (target === null) {
    return <div className={shell}>{content}</div>;
  }

  return (
    <Link
      href={target}
      // NRL and football match ids live in different namespaces; the href
      // disambiguates them, so every linked card reports its click.
      onClick={() => trackEvent("match_card_click", { match_id: match.match_id, href: target })}
      className={`card-hover ${shell}`}
    >
      {content}
    </Link>
  );
}

/** The Floodlight "also on"/timeline row body: one line of team names + a
 *  right-aligned lead % (or the scoreline once a match is underway), a
 *  time · venue sub-line, a thin labels-off probability bar, and — for a
 *  finished match — the model's verdict. `lead` is the model's best single
 *  number regardless of which outcome it favors (home, draw, or away) -- the
 *  prototype's "still favoured" read (design/Floodlight Prototype.dc.html:
 *  `Math.max(m.ph,m.pd,m.pa)`), lit lime once it clears 60%. Once the match is
 *  live or over the score leads instead: a stale pre-kickoff % on a result is
 *  worse than useless, so the big slot shows the actual scoreline and finished
 *  rows carry the "Called it"/"Upset" verdict, mirroring the full card. */
function CompactRow({
  match,
  live,
  finished,
  stale,
  kickoffPill,
  badge,
  margin,
  stopped,
  showPrediction,
}: {
  match: MatchSummary;
  live: boolean;
  finished: boolean;
  stale: boolean;
  kickoffPill: string | null;
  badge: "flag" | "club";
  margin?: number | null;
  stopped: string | null;
  showPrediction: boolean;
}) {
  const { teams } = match;
  // Once underway, promote the in-play win probabilities into the bar (same
  // idiom as FeatureHero) so a live row demoted here never shows stale odds.
  const probs = showPrediction
    ? (live && match.live_probabilities) || match.probabilities
    : null;
  // The bare number was ambiguous — 49% of WHAT? Name the outcome it belongs
  // to (home side, away side, or the draw) right under it. The number is the
  // bar's own sum-to-100 share for that outcome, so the two never disagree.
  const leadOutcome = probs ? topOutcome(probs) : null;
  const triple = probs ? pctTriple(probs) : null;
  const lead = triple && leadOutcome ? triple[leadOutcome] : null;
  const leadLabel =
    leadOutcome === "home" ? teams.home : leadOutcome === "away" ? teams.away : "Draw";
  const hasScore = match.score_home != null && match.score_away != null;
  const venueLabel = [match.venue ?? "Venue TBC", match.venue_city, match.venue_country]
    .filter(Boolean)
    .join(", ");
  const showScore = hasScore && (live || finished || stale);
  const verdict = finished ? predictionVerdict(match) : null;
  const metaLabel = live
    ? liveLabel(match)
    : finished
      ? "Full time"
      : stale
        ? RESULT_PENDING
        : stopped ?? kickoffPill ?? "Kickoff TBC";

  return (
    <>
      <div className="flex items-center gap-2.5">
        {/* BOTH crests. The row names both sides in its title, so showing only
            the home badge left every away team unidentifiable at a glance —
            the one thing a fixture list is scanned for. Overlapped rather than
            spaced: two 22px badges plus a gap cost ~26px of a 320px row, which
            eats into the title's truncation budget, while a -6px overlap costs
            ~16px and reads as a pairing. Both are decorative (ClubBadge and
            TeamBadge set aria-hidden themselves) — the names are already in the
            title, so this adds no screen-reader noise. */}
        <span className="flex shrink-0 items-center">
          {badge === "club" ? (
            <ClubBadge name={teams.home} size={22} />
          ) : (
            <TeamBadge team={teams.home} size={22} />
          )}
          <span className="-ml-1.5 rounded-full ring-2 ring-surface">
            {badge === "club" ? (
              <ClubBadge name={teams.away} size={22} />
            ) : (
              <TeamBadge team={teams.away} size={22} />
            )}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-sm font-bold tracking-tight">
            {teams.home} <span className="font-normal text-muted">v</span> {teams.away}
          </div>
          <div className="mt-0.5 truncate text-note">
            <span className={live ? "font-semibold text-loss-ink" : "text-muted"}>{metaLabel}</span>
            <span className="text-muted-solid"> · {venueLabel}</span>
          </div>
        </div>
        {showScore ? (
          <span className="shrink-0 font-display text-lg font-extrabold tabular-nums text-foreground">
            {formatScore(match.score_home, match.score_away)}
          </span>
        ) : (
          lead != null && (
            <span className="flex shrink-0 flex-col items-end">
              <span
                className={`font-display text-lg font-extrabold leading-tight tabular-nums ${
                  lead >= 60 ? "text-lime-deep" : "text-muted"
                }`}
              >
                {lead}%
              </span>
              <span className="max-w-[84px] truncate text-mini font-semibold uppercase tracking-wide text-muted">
                {leadLabel}
              </span>
            </span>
          )
        )}
      </div>
      {probs ? (
        <div className="mt-2.5">
          <ProbabilityBar
            probabilities={probs}
            homeLabel={teams.home}
            awayLabel={teams.away}
            size="row"
            showLabels={false}
          />
        </div>
      ) : (
        <p className="mt-2.5 text-note text-muted">Prediction pending…</p>
      )}
      {showPrediction && margin != null && !finished && (
        // NRL's expected-margin chip, a new line under the bar for dense rows.
        // Same humane form as the full card: favoured side, not a signed number.
        <div className="mt-2">
          <span className="rounded-lg bg-surface-2 px-2 py-0.5 font-bold tabular-nums text-foreground">
            <span className="mr-1 font-semibold text-muted">Model</span>
            {expectedMarginLabel(margin, teams.home, teams.away)}
          </span>
        </div>
      )}
      {verdict && (
        <div
          className={`mt-2 flex items-center gap-1.5 text-note font-semibold ${
            verdict.kind === "miss" ? "text-loss-ink" : "text-lime-deep"
          }`}
        >
          <span aria-hidden>{verdict.kind === "miss" ? "✕" : "✓"}</span>
          {verdict.kind === "miss"
            ? "Upset — we missed it"
            : verdict.kind === "exact"
              ? "Exact score!"
              : "Called it"}
          <BasisTag verdict={verdict} />
        </div>
      )}
    </>
  );
}

function TeamRow({
  name,
  score,
  live,
  badge,
}: {
  name: string;
  score?: number | null;
  live?: boolean;
  badge: "flag" | "club";
}) {
  return (
    <div className="flex items-center gap-2.5">
      {badge === "club" ? <ClubBadge name={name} size={24} /> : <TeamBadge team={name} size={24} />}
      <span className="min-w-0 flex-1 truncate font-display text-lead font-semibold tracking-tight">
        {name}
      </span>
      {live && score != null && (
        <span className="font-display text-lg font-extrabold tabular-nums">{score}</span>
      )}
      <FavouriteMark team={name} />
    </div>
  );
}

/** A static star for a favourited team. Deliberately not a button: this row
 *  sits inside the card's link, and an interactive control nested in an <a> is
 *  invalid and traps keyboard users. Favourites are toggled on the team page. */
function FavouriteMark({ team }: { team: string }) {
  const { isFavorite } = useFavorites();
  if (!isFavorite(team)) return null;
  return (
    <span className="text-sm leading-none text-amber-ink">
      <span aria-hidden>★</span>
      <span className="sr-only">(favourite team)</span>
    </span>
  );
}
