import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getNrlLadderServer,
  getNrlMatchesServer,
  getNrlRecordServer,
  getOriginSeriesServer,
} from "@/lib/api";
import { StandingsTable } from "@/components/StandingsTable";
import { IntelPanel } from "@/components/IntelPanel";
import { FeatureHero } from "@/components/FeatureHero";
import { TimelineSpine } from "@/components/TimelineSpine";
import { ladderRowsToStandings, nrlExpectedMargin, nrlMatchHref, nrlMatchToSummary } from "@/lib/nrlAdapters";
import { isNrlLiveNow } from "@/lib/nrlLive";
import { isNrlOpenMatch, nrlSeasonStart, nrlSeasonState, nrlStartLabel } from "@/lib/nrlTips";
import { COMPETITIONS } from "@/lib/sports";
import type { LadderResponse, NrlMatchesResponse, NrlRecord, NrlRound, OriginSeriesResponse } from "@/lib/types";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "NRL predictions — FinalWhistle",
  description: "Match predictions from the FinalWhistle model, the ladder and the model's record for the NRL season.",
};

/** The premiers, when the season's last round is a single decided match. */
function premierOf(rounds: NrlRound[]): string | null {
  const last = rounds[rounds.length - 1];
  const final = last?.matches.length === 1 ? last.matches[0] : null;
  if (!final || final.status !== "finished" || final.score_home == null || final.score_away == null) return null;
  if (final.score_home === final.score_away) return null;
  return final.score_home > final.score_away ? final.home : final.away;
}

/** NRL home, by where the season stands (lib/nrlTips.ts nrlSeasonState, the
 *  rule /play, /nrl/tips and the home page share): current-round fixtures,
 *  mini ladder and movers in season; once nothing is left to play, an
 *  off-season state (premiers, the model's record, when it's back, a way into
 *  a live competition); and once next season's draw is loaded but Round 1 is
 *  weeks away, a pre-season state -- never a March fixture as the feature. */
export default async function NrlHomePage() {
  const [fixtures, ladder, origin] = await Promise.all([
    getNrlMatchesServer().catch(() => null),
    getNrlLadderServer().catch(() => null),
    getOriginSeriesServer().catch(() => null),
  ]);
  if (!fixtures) notFound();

  const now = new Date();
  const seasonState = nrlSeasonState(fixtures.rounds, now);
  if (seasonState === "pre-season") {
    const record = await getNrlRecordServer().catch(() => null);
    return (
      <PreSeason season={fixtures.season} startIso={nrlSeasonStart(fixtures.rounds)} record={record} origin={origin} />
    );
  }
  if (seasonState === "complete") {
    const record = await getNrlRecordServer().catch(() => null);
    return (
      <OffSeason fixtures={fixtures} premier={premierOf(fixtures.rounds)} record={record} ladder={ladder} origin={origin} />
    );
  }

  const current = fixtures.rounds.find((r) => r.matches.some((m) => isNrlOpenMatch(m, now)));

  // Between rounds (nothing live or scheduled yet, season not over) the last
  // round stays on screen as results and the hero shows its honest empty
  // state -- a played match is never dressed up as tonight's feature.
  const round = current ?? fixtures.rounds[fixtures.rounds.length - 1];
  const featured = current
    ? current.matches.find((m) => isNrlLiveNow(m, now)) ??
      current.matches.find((m) => isNrlOpenMatch(m, now)) ??
      null
    : null;
  const roundMatches = (round?.matches ?? []).filter((m) => m.id !== featured?.id);

  // Per-card maps keyed by match_id (= NrlMatch.id) — the detail href and the
  // model's expected margin, threaded onto each compact card in the spine.
  const cardHref: Record<number, string | null> = {};
  const cardMargin: Record<number, number | null> = {};
  for (const m of roundMatches) {
    cardHref[m.id] = nrlMatchHref(fixtures.season, round?.round, m.match_no);
    cardMargin[m.id] = nrlExpectedMargin(m);
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold">NRL · Season {fixtures.season}</h1>
      <p className="mt-1 text-sm text-muted">
        Round {round?.round ?? "—"} · model predictions frozen at kickoff
      </p>

      <div className="mt-6">
        <FeatureHero
          match={featured ? nrlMatchToSummary(featured) : null}
          comp="nrl"
          tz="Australia/Sydney"
          badge="club"
          href={
            featured
              ? nrlMatchHref(fixtures.season, round?.round, featured.match_no)
              : undefined
          }
          margin={featured ? nrlExpectedMargin(featured) : null}
          eyebrow="Next up"
        />
      </div>

      <IntelPanel sport="nrl" />

      <OriginTeaser origin={origin} />

      <div className="mt-6 grid gap-4 md:grid-cols-[1fr_320px]">
        {roundMatches.length > 0 ? (
          <TimelineSpine
            days={[
              {
                key: `round-${round?.round ?? "tbc"}`,
                heading: `Round ${round?.round ?? "TBC"}`,
                matches: roundMatches.map(nrlMatchToSummary),
              },
            ]}
            tz="Australia/Sydney"
            badge="club"
            cardHref={cardHref}
            cardMargin={cardMargin}
          />
        ) : (
          <p className="text-sm text-muted">No other fixtures this round.</p>
        )}
        <MiniLadder ladder={ladder} label="Ladder" />
      </div>
    </div>
  );
}

function OffSeason({
  fixtures,
  premier,
  record,
  ladder,
  origin,
}: {
  fixtures: NrlMatchesResponse;
  premier: string | null;
  record: NrlRecord | null;
  ladder: LadderResponse | null;
  origin: OriginSeriesResponse | null;
}) {
  const season = fixtures.season;
  const accuracy =
    record && record.evaluated_matches > 0 && record.winner_accuracy != null
      ? Math.round(record.winner_accuracy * 100)
      : null;

  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold">NRL · Season {season}</h1>
      <p className="mt-1 text-sm text-muted">Season complete · final ladder and the model&apos;s record</p>

      <section
        aria-labelledby="nrl-off-season"
        className="glass relative mt-6 overflow-hidden rounded-[16px] p-5"
      >
        <span aria-hidden className="floodlight-glow pointer-events-none absolute inset-0" />
        <div className="relative">
          <h2 id="nrl-off-season" className="font-display text-headline font-extrabold tracking-tight">
            {season} season complete
          </h2>
          {premier ? (
            <p className="mt-1.5 text-body font-semibold">{premier} are the {season} premiers.</p>
          ) : null}
          {accuracy != null && record ? (
            <Link
              href="/nrl/record"
              className="mt-2 inline-flex text-sm font-semibold text-lime-deep underline-offset-2 hover:underline"
            >
              The model called {accuracy}% of winners across {record.evaluated_matches} graded matches →
            </Link>
          ) : null}
          <p className="mt-3 text-sm text-muted">Back for Round 1, March {season + 1}.</p>
          <Link
            href="/play?competition=epl"
            className="mt-4 flex min-h-[44px] items-center justify-center rounded-[12px] bg-win px-4 font-display text-sm font-semibold text-action-ink transition hover:brightness-[1.06] sm:inline-flex"
          >
            Play the Premier League meanwhile
          </Link>
        </div>
      </section>

      <OriginTeaser origin={origin} />

      <div className="mt-6 max-w-md">
        <MiniLadder ladder={ladder} label="Final ladder" />
      </div>
    </div>
  );
}

/** Next season's draw is loaded and Round 1 is weeks away: no feature card,
 *  movers or (all-zero) ladder -- when it starts, where the draw is, the
 *  model's last-season record, and a live competition meanwhile. */
function PreSeason({
  season,
  startIso,
  record,
  origin,
}: {
  season: number;
  startIso: string | null;
  record: NrlRecord | null;
  origin: OriginSeriesResponse | null;
}) {
  const accuracy =
    record && record.evaluated_matches > 0 && record.winner_accuracy != null
      ? Math.round(record.winner_accuracy * 100)
      : null;

  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold">NRL · Season {season}</h1>
      <p className="mt-1 text-sm text-muted">Pre-season · the {season} draw is out</p>

      <section
        aria-labelledby="nrl-pre-season"
        className="glass relative mt-6 overflow-hidden rounded-[16px] p-5"
      >
        <span aria-hidden className="floodlight-glow pointer-events-none absolute inset-0" />
        <div className="relative">
          <h2 id="nrl-pre-season" className="font-display text-headline font-extrabold tracking-tight">
            Season {season} starts {startIso ? nrlStartLabel(startIso) : "soon"} · draw is out
          </h2>
          {accuracy != null && record ? (
            <Link
              href="/nrl/record"
              className="mt-2 inline-flex text-sm font-semibold text-lime-deep underline-offset-2 hover:underline"
            >
              Last season the model called {accuracy}% of winners across {record.evaluated_matches} graded matches →
            </Link>
          ) : null}
          <Link
            href="/nrl/matches"
            className="mt-2 block text-sm font-semibold text-lime-deep underline-offset-2 hover:underline"
          >
            See the {season} draw →
          </Link>
          <Link
            href="/play?competition=epl"
            className="mt-4 flex min-h-[44px] items-center justify-center rounded-[12px] bg-win px-4 font-display text-sm font-semibold text-action-ink transition hover:brightness-[1.06] sm:inline-flex"
          >
            Play the Premier League meanwhile
          </Link>
        </div>
      </section>

      <OriginTeaser origin={origin} />
    </div>
  );
}

function OriginTeaser({ origin }: { origin: OriginSeriesResponse | null }) {
  if (!origin) return null;
  return (
    <Link
      href="/nrl/origin"
      className="glass mt-6 block rounded-2xl p-4 transition hover:bg-white/5"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-display text-label font-semibold uppercase tracking-wider text-muted">
            State of Origin · {origin.season}
          </p>
          <p className="mt-1 font-display text-lg font-extrabold">
            NSW Blues {origin.series.blues_wins} – {origin.series.maroons_wins} QLD
            Maroons
            {origin.series.drawn_games ? ` · ${origin.series.drawn_games} drawn` : ""}
          </p>
        </div>
        <span className="shrink-0 text-xs font-semibold text-lime-deep">
          Series &amp; model →
        </span>
      </div>
    </Link>
  );
}

function MiniLadder({ ladder, label }: { ladder: LadderResponse | null; label: string }) {
  if (!ladder) return null;
  return (
    <div className="glass h-fit rounded-2xl p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-display text-label font-semibold uppercase tracking-wider text-muted">
          {label}
        </span>
        <Link href="/nrl/ladder" className="text-xs font-semibold text-lime-deep">
          Full ladder →
        </Link>
      </div>
      <StandingsTable
        standings={ladderRowsToStandings(ladder.rows).slice(0, 4)}
        zones={COMPETITIONS.nrl.zones}
        badge="club"
        teamBasePath="/nrl/team"
        teamHeader="Club"
        columns={["pts"]}
      />
    </div>
  );
}
