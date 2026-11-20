import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getGroupsServer,
  getMatchServer,
  getMatchSummaryServer,
  getUpcomingMatchesServer,
} from "@/lib/api";
import { APP_NAME } from "@/lib/constants";
import { formatScore, pctTriple } from "@/lib/format";
import { canRevealModelPublicly } from "@/lib/reveal";
import { dedupeStandings } from "@/lib/standingsRows";
import { AvailabilityNote } from "@/components/AvailabilityNote";
import { SportsEventJsonLd } from "@/components/SportsEventJsonLd";
import { MatchLiveProvider } from "@/components/match/MatchLiveProvider";
import { MatchView } from "@/components/match/MatchView";
import {
  modelDataFrom,
  type Standing,
  type StandingLine,
  type WeekFixture,
} from "@/components/match/matchPageData";
import type { Group, MatchSummary, Prediction } from "@/lib/types";
import {
  COMPETITIONS,
  competitionLinks,
  DEFAULT_COMPETITION,
  footballMatchHref,
  type CompetitionId,
} from "@/lib/sports";

/** A secondary read that must never take the page down. */
const optional = <T,>(read: () => Promise<T | null> | T | null | undefined): Promise<T | null> =>
  Promise.resolve()
    .then(read)
    .then((v) => v ?? null)
    .catch(() => null);

/** Model fields a summary carries. Stripped before an OPEN fixture's summary
 *  is handed to the client, so neither the HTML nor the RSC payload holds the
 *  model's call (the live poll fetches the summary client-side later). */
function publicSummary(s: MatchSummary | null, reveal: boolean): MatchSummary | null {
  if (!s || reveal) return s;
  return {
    ...s,
    predicted_winner: null,
    probabilities: null,
    predicted_score: null,
    confidence: null,
    live_probabilities: null,
  };
}

/** Title, description and Open Graph text. Read by people who are not the
 *  picker (search, link previews), so an open fixture never names the
 *  model's numbers (lib/reveal canRevealModelPublicly). */
export async function generateMatchMetadata(
  params: Promise<{ id: string }>,
  competition: CompetitionId = DEFAULT_COMPETITION,
): Promise<Metadata> {
  const { id } = await params;
  const [p, summary] = await Promise.all([
    getMatchServer(id, competition),
    optional(() => getMatchSummaryServer(id, competition)),
  ]);
  if (!p) return { title: `Match — ${APP_NAME}` };
  const { home, away } = p.teams;
  const reveal = canRevealModelPublicly(competition, summary?.status ?? "scheduled", summary?.kickoff_utc ?? p.kickoff_utc);
  let title: string;
  let description: string;
  if (reveal) {
    title = `${home} vs ${away} — prediction | ${APP_NAME}`;
    const t = pctTriple(p.probabilities);
    const split = t ? `: ${home} ${t.home}%, draw ${t.draw}%, ${away} ${t.away}%` : "";
    description = `Model prediction for ${home} vs ${away}${split}. Most likely score ${formatScore(p.predicted_score.home, p.predicted_score.away)}.`;
  } else {
    title = `${home} v ${away} — make your pick | ${APP_NAME}`;
    description = `${home} v ${away}: call the score before kick-off, then see the model’s.`;
  }
  return {
    title,
    description,
    // The served, competition-scoped URL -- never /match/<id>, which redirects.
    alternates: { canonical: footballMatchHref(competition, id) },
    openGraph: { title, description },
  };
}

/** The table rows of the two clubs (the group that holds both of them). */
function standingFor(groups: Group[] | null, competition: CompetitionId, home: string, away: string): Standing | null {
  if (!groups) return null;
  for (const g of groups) {
    const rows = dedupeStandings(g.standings ?? []);
    const hi = rows.findIndex((r) => r.team === home);
    const ai = rows.findIndex((r) => r.team === away);
    if (hi < 0 && ai < 0) continue;
    if (hi < 0 || ai < 0) return null; // different groups: no shared table
    const line = (i: number): StandingLine => {
      const r = rows[i];
      return {
        teamId: r.team_id,
        team: r.team,
        pos: i + 1,
        won: r.won ?? 0,
        drawn: r.drawn ?? 0,
        lost: r.lost ?? 0,
        gd: r.projected_goal_diff,
        points: r.projected_points,
      };
    };
    const played = Math.max(0, ...rows.map((r) => r.played ?? 0));
    const note =
      COMPETITIONS[competition].format === "league" && groups.length === 1
        ? played > 0
          ? `The table after ${played} ${played === 1 ? "matchweek" : "matchweeks"}.`
          : "The table before a ball is kicked."
        : `${g.name}.`;
    return { home: line(hi), away: line(ai), note };
  }
  return null;
}

/** The match's matchweek in kick-off order (ids, names, status only). */
function weekOf(all: MatchSummary[] | null, matchweek: number | null | undefined): WeekFixture[] {
  if (!all || typeof matchweek !== "number") return [];
  return all
    .filter((m) => m.matchweek === matchweek)
    .sort((a, b) => {
      const ka = a.kickoff_utc ?? "";
      const kb = b.kickoff_utc ?? "";
      return ka < kb ? -1 : ka > kb ? 1 : a.match_id - b.match_id;
    })
    .map((m) => ({
      id: m.match_id,
      home: m.teams.home,
      away: m.teams.away,
      kickoffUtc: m.kickoff_utc,
      status: m.status,
      matchweek: m.matchweek ?? null,
    }));
}

/** The direction-G match page (both /football/{comp}/match/{id} and, via its
 *  lookup, /match/{id}): top bar, hero with the pick, then the model's call
 *  under the reveal rule, the reasons, the goal chances and the two clubs'
 *  table rows. Everything the model says about an OPEN fixture is left out of
 *  the server render entirely; the client reads it once the viewer's pick is
 *  locked. */
export async function renderMatchDetailPage(
  params: Promise<{ id: string }>,
  competition: CompetitionId = DEFAULT_COMPETITION,
) {
  const { id } = await params;
  const comp = COMPETITIONS[competition];
  const [p, summary, groups, all] = await Promise.all([
    getMatchServer(id, competition),
    // Seeds the hero and the pick with the actual status/score; the page must
    // still render (prediction-only) if this secondary fetch hiccups.
    optional(() => getMatchSummaryServer(id, competition)),
    optional(() => getGroupsServer(competition)),
    optional(() => getUpcomingMatchesServer(competition)),
  ]);
  // A just-drawn knockout tie exists (summary is served) before its prediction
  // is generated: same page, "on the way" in place of the call. 404 only when
  // the match genuinely does not exist.
  if (!p && !summary) notFound();
  const base: Pick<Prediction, "match_id" | "teams" | "kickoff_utc" | "venue" | "venue_city" | "venue_country"> & {
    home_team_id: number | null;
    away_team_id: number | null;
    matchweek?: number | null;
  } = p ?? {
    match_id: summary!.match_id,
    teams: summary!.teams,
    kickoff_utc: summary!.kickoff_utc,
    venue: summary!.venue,
    venue_city: summary!.venue_city,
    venue_country: summary!.venue_country,
    home_team_id: null,
    away_team_id: null,
    matchweek: summary!.matchweek,
  };

  const { home, away } = base.teams;
  const kickoff = summary?.kickoff_utc ?? base.kickoff_utc;
  const renderedAt = new Date();
  const reveal = canRevealModelPublicly(competition, summary?.status ?? "scheduled", kickoff, renderedAt);
  const matchweek = p?.matchweek !== undefined ? p.matchweek : summary?.matchweek;
  const week = weekOf(all, matchweek);
  const links = competitionLinks(competition);
  const back =
    typeof matchweek === "number"
      ? { href: `${links.home}?mw=${matchweek}`, label: `Matchweek ${matchweek}` }
      : { href: links.home, label: "All matches" };

  return (
    <>
      <SportsEventJsonLd
        home={home}
        away={away}
        competitionLabel={comp.label}
        kickoffUtc={kickoff}
        venue={base.venue}
        venueCity={base.venue_city}
        venueCountry={base.venue_country}
        canonicalPath={footballMatchHref(competition, base.match_id)}
        status={summary?.status ?? null}
      />
      {/* One live feed for the hero, the pick and the reveal: the pick locks
          and the call reveals the moment kickoff passes on an open tab. Its
          first client pass uses this render instant, so cached (ISR) HTML
          hydrates without a clock mismatch. */}
      <MatchLiveProvider
        matchId={base.match_id}
        competition={competition}
        kickoffUtc={kickoff}
        initialSummary={publicSummary(summary, reveal)}
        serverNow={renderedAt.toISOString()}
      >
        <MatchView
          competition={competition}
          competitionLabel={comp.label}
          matchId={base.match_id}
          home={home}
          away={away}
          homeTeamId={base.home_team_id}
          awayTeamId={base.away_team_id}
          kickoffUtc={kickoff}
          venue={base.venue ?? base.venue_city}
          matchweek={matchweek}
          week={week}
          standing={standingFor(groups, competition, home, away)}
          model={p && reveal ? modelDataFrom(p) : null}
          hasPrediction={!!p}
          hasReasons={!!p && p.reasons.length > 0}
          hasGoalChances={!!p?.goal_markets}
          back={back}
        />
      </MatchLiveProvider>
      {p?.availability && (
        <div className="mt-6">
          <AvailabilityNote availability={p.availability} />
        </div>
      )}
    </>
  );
}
