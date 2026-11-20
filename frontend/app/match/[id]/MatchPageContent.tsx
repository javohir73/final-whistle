import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getMatchServer,
  getMatchSummaryServer,
  getMatchGoalscorersServer,
  getProbHistoryServer,
} from "@/lib/api";
import { getCompetitionTournament } from "@/lib/tournament";
import { APP_NAME } from "@/lib/constants";
import { formatScore, pctTriple } from "@/lib/format";
import { ReasonsList } from "@/components/ReasonsList";
import { FeatureImportanceChart } from "@/components/FeatureImportanceChart";
import { MatchScoreboard } from "@/components/MatchScoreboard";
import { MatchLineups } from "@/components/MatchLineups";
import { ModelVsMarket } from "@/components/ModelVsMarket";
import { ShareButton } from "@/components/ShareButton";
import { GoalMarkets } from "@/components/GoalMarkets";
import { SportsEventJsonLd } from "@/components/SportsEventJsonLd";
import { PremiumMarkets } from "@/components/PremiumMarkets";
import { LikelyScorers } from "@/components/LikelyScorers";
import { AvailabilityNote } from "@/components/AvailabilityNote";
import { MatchWriteup } from "@/components/MatchWriteup";
import { WinProbTimeline, hasForecastTrajectory } from "@/components/WinProbTimeline";
import { MatchLiveProvider } from "@/components/match/MatchLiveProvider";
import { MatchPick } from "@/components/match/MatchPick";
import { LazyMount } from "@/components/match/LazyMount";
import { LocalTime } from "@/components/match/LocalTime";
import type { MatchSummary } from "@/lib/types";
import {
  COMPETITIONS,
  DEFAULT_COMPETITION,
  footballMatchHref,
  type CompetitionId,
} from "@/lib/sports";

export async function generateMatchMetadata(
  params: Promise<{ id: string }>,
  competition: CompetitionId = DEFAULT_COMPETITION,
): Promise<Metadata> {
  const { id } = await params;
  const p = await getMatchServer(id, competition);
  if (!p) return { title: `Match — ${APP_NAME}` };
  const title = `${p.teams.home} vs ${p.teams.away} — prediction | ${APP_NAME}`;
  const t = pctTriple(p.probabilities);
  const split = t ? `: ${p.teams.home} ${t.home}%, draw ${t.draw}%, ${p.teams.away} ${t.away}%` : "";
  const description = `Model prediction for ${p.teams.home} vs ${p.teams.away}${split}. Most likely score ${formatScore(p.predicted_score.home, p.predicted_score.away)}.`;
  return {
    title, description,
    // The served, competition-scoped URL -- never /match/<id>, which redirects.
    alternates: { canonical: footballMatchHref(competition, id) },
    openGraph: { title, description },
  };
}

/** The match centre, in the order a visitor needs it (UX rebuild §3.4):
 *  hero (status, crests, "vs" or the real score, and the model's call: one
 *  sentence, one labelled bar, a most-likely-score chip, the confidence tier)
 *  → your pick (#pick, the scored game, directly under the call) → why (#why)
 *  → forecast & market (only when there is something to show) → goals &
 *  scorers → lineups → this prediction's own timestamp.
 *
 *  Data: the prediction, the live summary and the competition resolve together
 *  (the first two decide notFound vs the pending view); the secondary reads
 *  then run together. They used to run one after another, six in a row. */
export async function renderMatchDetailPage(
  params: Promise<{ id: string }>,
  competition: CompetitionId = DEFAULT_COMPETITION,
) {
  const { id } = await params;
  const [p, summary, tournament] = await Promise.all([
    getMatchServer(id, competition),
    // Seeds the hero and the pick with the actual status/score; the page must
    // still render (prediction-only) if this secondary fetch hiccups.
    getMatchSummaryServer(id, competition).catch(() => null),
    getCompetitionTournament(competition),
  ]);
  const fixturesHref = `${COMPETITIONS[competition].basePath}/fixtures`;
  // A just-drawn knockout tie exists (summary is served) before its prediction is
  // generated. Show the matchup + a "prediction on the way" note rather than a
  // hard 404; only 404 when the match genuinely doesn't exist.
  if (!p) {
    if (!summary) notFound();
    return (
      <PredictionPending
        summary={summary}
        competition={competition}
        tournamentName={tournament.name}
        fixturesHref={fixturesHref}
      />
    );
  }
  const [goalscorers, history] = await Promise.all([
    // Likely scorers (squad estimate or confirmed XI); null until player data
    // exists for a team. A hiccup here must not take down the page.
    getMatchGoalscorersServer(id).catch(() => null),
    // Pre-match forecast trajectory, server-rendered as an SVG (no client
    // fetch, no hydration mismatch). Under two points there is no chart.
    getProbHistoryServer(id).catch(() => null),
  ]);

  const { home, away } = p.teams;
  const venue = [p.venue ?? "Venue TBC", p.venue_city, p.venue_country]
    .filter(Boolean)
    .join(", ");
  const canonicalPath = footballMatchHref(competition, p.match_id);
  const renderedAt = new Date();
  const showForecast = hasForecastTrajectory(history?.points);
  const hasMarket = !!(p.odds_comparison?.available && p.odds_comparison.market);

  return (
    <div className="fade-up space-y-6">
      {/* The matchup is presented graphically by the hero; this gives crawlers
          and screen-reader users the page's one top-level title. */}
      <h1 className="sr-only">
        {home} vs {away} — {tournament.name} prediction
      </h1>

      <SportsEventJsonLd
        home={home}
        away={away}
        competitionLabel={tournament.name}
        kickoffUtc={p.kickoff_utc}
        venue={p.venue}
        venueCity={p.venue_city}
        venueCountry={p.venue_country}
        canonicalPath={canonicalPath}
        status={summary?.status ?? null}
      />

      <TopRow
        fixturesHref={fixturesHref}
        group={p.group}
        shareTitle={`${home} vs ${away} — ${tournament.name} prediction`}
      />

      {/* One live feed for the hero and the pick: the pick locks the moment
          the hero shows kickoff, on an open tab, without a reload. It renders
          its first client pass with this page's render instant, so the cached
          (ISR) HTML hydrates without a clock mismatch. */}
      <MatchLiveProvider
        matchId={p.match_id}
        competition={competition}
        kickoffUtc={p.kickoff_utc}
        initialSummary={summary}
        serverNow={renderedAt.toISOString()}
      >
        <MatchScoreboard
          matchId={p.match_id}
          competitionLabel={tournament.name}
          home={home}
          away={away}
          homeTeamId={p.home_team_id}
          awayTeamId={p.away_team_id}
          kickoffUtc={p.kickoff_utc}
          venue={venue}
          probabilities={p.probabilities}
          predicted={p.predicted_score}
          initialSummary={summary}
          confidence={p.confidence}
          knockout={p.knockout ?? null}
          competition={competition}
        />
        <MatchPick
          competition={competition}
          matchId={p.match_id}
          home={home}
          away={away}
          kickoffUtc={p.kickoff_utc}
          matchweek={p.matchweek}
        />
      </MatchLiveProvider>

      {/* Why: the narrative (case for each side, the call, the caveat), the
          key factors and what drove the number, under ONE heading. */}
      <section id="why" aria-labelledby="why-heading" className="glass scroll-mt-24 rounded-2xl p-6">
        <h2 id="why-heading" className="font-display text-lg font-bold text-foreground">
          Why this prediction
        </h2>
        <div className="mt-4 space-y-6">
          <MatchWriteup home={home} away={away} writeup={p.writeup} />
          {p.reasons.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Key factors</h3>
              <ReasonsList reasons={p.reasons} />
            </div>
          )}
          {p.top_features.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                What drove this prediction
              </h3>
              <FeatureImportanceChart features={p.top_features} />
            </div>
          )}
        </div>
      </section>

      {/* Forecast & market: only with something to show. The old single-bar
          "forecast" was a third copy of the hero's bar; the market's two bars
          were the fourth and fifth. */}
      {(showForecast || hasMarket) && (
        <section
          id="forecast"
          aria-labelledby="forecast-heading"
          className="glass scroll-mt-24 rounded-2xl p-6"
        >
          <h2 id="forecast-heading" className="mb-4 font-display text-lg font-bold text-foreground">
            Forecast &amp; market
          </h2>
          {showForecast && history && (
            <WinProbTimeline
              points={history.points}
              homeLabel={home}
              kickoffUtc={p.kickoff_utc}
              now={renderedAt}
            />
          )}
          <div className={showForecast ? "mt-5 border-t border-border pt-4" : undefined}>
            <ModelVsMarket prediction={p} home={home} away={away} />
          </div>
        </section>
      )}

      {/* Goals & scorers (each hidden until predicted), then the Premium
          teaser next to the related markets. */}
      <div id="goals" className="scroll-mt-24 space-y-6">
        {p.goal_markets && <GoalMarkets home={home} away={away} markets={p.goal_markets} />}
        {goalscorers && <LikelyScorers home={home} away={away} data={goalscorers} />}
        <PremiumMarkets
          matchId={p.match_id}
          home={home}
          away={away}
          competition={competition}
          returnTo={canonicalPath}
        />
      </div>

      <LineupsSection matchId={p.match_id} availability={p.availability} />

      <footer className="text-center text-xs leading-relaxed text-muted">
        {p.generated_at && (
          <>
            Prediction generated <LocalTime iso={p.generated_at} />
            {" · "}
          </>
        )}
        {p.model_version && <>model {p.model_version} · </>}
        {p.disclaimer}
      </footer>
    </div>
  );
}

function TopRow({
  fixturesHref,
  group,
  shareTitle,
}: {
  fixturesHref: string;
  group: string | null;
  shareTitle: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Link href={fixturesHref} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
        <span aria-hidden>←</span> All fixtures
      </Link>
      {group && <span className="font-display text-body font-semibold text-muted">{group}</span>}
      <ShareButton title={shareTitle} />
    </div>
  );
}

/** Lineups inline (no more Overview/Lineups tab), fetched only once they are
 *  about to be seen; the availability note is announced-XI context. */
function LineupsSection({
  matchId,
  availability,
}: {
  matchId: number;
  availability?: Parameters<typeof AvailabilityNote>[0]["availability"];
}) {
  return (
    <section id="lineups" aria-labelledby="lineups-heading" className="scroll-mt-24 space-y-3">
      {/* Focusable so "Show lineups" can hand focus here when it unmounts. */}
      <h2 id="lineups-heading" tabIndex={-1} className="px-0.5 font-display text-lg font-bold text-foreground">
        Lineups
      </h2>
      <LazyMount label="Show lineups" focusTargetId="lineups-heading">
        <MatchLineups matchId={matchId} />
      </LazyMount>
      <AvailabilityNote availability={availability} />
    </section>
  );
}

/** Shown when a match exists but its prediction hasn't been generated yet
 *  (e.g. a knockout tie just drawn, before the next pipeline run). The same
 *  hero (with an "on the way" note where the call goes) and the same pick
 *  shell -- league picks open before the model has spoken -- then lineups.
 *  Never a 404. */
function PredictionPending({
  summary,
  competition,
  tournamentName,
  fixturesHref,
}: {
  summary: MatchSummary;
  competition: CompetitionId;
  tournamentName: string;
  fixturesHref: string;
}) {
  const { home, away } = summary.teams;
  const venue = [summary.venue ?? "Venue TBC", summary.venue_city, summary.venue_country]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="fade-up space-y-6">
      <h1 className="sr-only">
        {home} vs {away} — {tournamentName}
      </h1>
      <TopRow fixturesHref={fixturesHref} group={summary.group} shareTitle={`${home} vs ${away} — ${tournamentName}`} />

      <MatchLiveProvider
        matchId={summary.match_id}
        competition={competition}
        kickoffUtc={summary.kickoff_utc}
        initialSummary={summary}
        serverNow={new Date().toISOString()}
      >
        <MatchScoreboard
          matchId={summary.match_id}
          competitionLabel={tournamentName}
          home={home}
          away={away}
          kickoffUtc={summary.kickoff_utc}
          venue={venue}
          probabilities={null}
          predicted={null}
          initialSummary={summary}
          competition={competition}
        />
        <MatchPick
          competition={competition}
          matchId={summary.match_id}
          home={home}
          away={away}
          kickoffUtc={summary.kickoff_utc}
          matchweek={summary.matchweek}
        />
      </MatchLiveProvider>

      <LineupsSection matchId={summary.match_id} />
    </div>
  );
}
