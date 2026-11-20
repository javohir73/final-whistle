import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTeamServer, getGroupServer, getGroupsServer, getUpcomingMatchesServer } from "@/lib/api";
import { getCompetitionTournament } from "@/lib/tournament";
import { APP_NAME } from "@/lib/constants";
import { canRevealModelPublicly } from "@/lib/reveal";
import {
  COMPETITIONS,
  DEFAULT_COMPETITION,
  competitionLinks,
  type CompetitionId,
} from "@/lib/sports";
import { dedupeStandings, ordinal, seasonLabel } from "@/lib/standingsRows";
import type { MatchSummary, StandingRow } from "@/lib/types";
import { ClubBadge } from "@/components/ClubBadge";
import { TeamBadge } from "@/components/TeamBadge";
import { FormStrip } from "@/components/FormStrip";
import { StandingsTable } from "@/components/StandingsTable";
import { TeamFixtures } from "@/components/TeamFixtures";
import { selectTeamFixtures, type TeamFixture } from "@/lib/teamFixtures";
import { MiniTableCard } from "@/components/rail/MiniTableCard";
import {
  Card,
  CardHead,
  DayBand,
  Main,
  Note,
  PageHead,
  PageLayout,
  Rail,
  Stat,
  StatGrid,
  TextLink,
} from "@/components/ui";

export async function generateTeamMetadata(
  params: Promise<{ id: string }>,
  competition: CompetitionId = DEFAULT_COMPETITION,
): Promise<Metadata> {
  const { id } = await params;
  const [data, tournament] = await Promise.all([
    getTeamServer(id, competition),
    getCompetitionTournament(competition),
  ]);
  if (!data) return { title: `Team — ${APP_NAME}` };
  const t = data.team;
  const title = `${t.name} — ${tournament.name} | ${APP_NAME}`;
  // No model numbers here: metadata is read by people who have not picked.
  const description =
    COMPETITIONS[competition].format === "league"
      ? `${t.name} in the ${tournament.name}: table position, results and next matches.`
      : `${t.name} at the ${tournament.name}: results, group and how the model called each match.`;
  return {
    title,
    description,
    alternates: { canonical: `/team/${id}` },
    openGraph: { title, description },
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  return generateTeamMetadata(params);
}

/** A fixture trimmed to what the club page renders. The model's score rides
 *  along ONLY where anyone may see it (finished / kicked off / no pick game);
 *  an open fixture's call never reaches the server HTML. */
export function toTeamFixture(m: MatchSummary, comp: CompetitionId, now: Date): TeamFixture {
  const ps = m.predicted_score;
  const publicModel =
    ps && ps.home != null && ps.away != null && canRevealModelPublicly(comp, m.status, m.kickoff_utc, now)
      ? { home: ps.home, away: ps.away }
      : null;
  return {
    match_id: m.match_id,
    kickoff_utc: m.kickoff_utc,
    status: m.status,
    teams: { home: m.teams.home, away: m.teams.away },
    score_home: m.score_home,
    score_away: m.score_away,
    matchweek: m.matchweek ?? null,
    stage: m.stage,
    group: m.group,
    competition: comp,
    model: publicModel,
  };
}

/** W/D/L and goals from finished fixtures (when there is no table row). */
function tallyFromFixtures(fixtures: TeamFixture[], team: string) {
  const t = { won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, played: 0 };
  for (const m of fixtures) {
    if (m.status !== "finished" || m.score_home == null || m.score_away == null) continue;
    const home = m.teams.home === team;
    const f = home ? m.score_home : m.score_away;
    const a = home ? m.score_away : m.score_home;
    t.played += 1;
    t.gf += f;
    t.ga += a;
    if (f > a) t.won += 1;
    else if (f < a) t.lost += 1;
    else t.drawn += 1;
  }
  return t;
}

const KO_ORDER = ["R32", "R16", "QF", "SF", "third_place", "final"];

/** One line on how a national team's tournament ended (archive pages). */
function tournamentOutcome(fixtures: TeamFixture[], team: string): string | null {
  const ko = fixtures
    .filter((m) => m.status === "finished" && m.stage && KO_ORDER.includes(m.stage))
    .sort((a, b) => KO_ORDER.indexOf(a.stage as string) - KO_ORDER.indexOf(b.stage as string));
  if (ko.length === 0) return fixtures.some((m) => m.status === "finished") ? "Out in the group stage." : null;
  const last = ko[ko.length - 1];
  const home = last.teams.home === team;
  const f = (home ? last.score_home : last.score_away) ?? 0;
  const a = (home ? last.score_away : last.score_home) ?? 0;
  const won = f > a ? true : f < a ? false : null; // a draw went to penalties; the feed may not say who won
  switch (last.stage) {
    case "final":
      return won === true ? "Won the World Cup." : won === false ? "Runners-up, beaten in the final." : "Reached the final.";
    case "third_place":
      return won === true ? "Finished third." : won === false ? "Finished fourth." : "Played the third-place match.";
    case "SF":
      return "Reached the semi-finals.";
    case "QF":
      return "Reached the quarter-finals.";
    case "R16":
      return "Reached the round of 16.";
    default:
      return "Reached the round of 32.";
  }
}

export async function renderTeamPage(
  params: Promise<{ id: string }>,
  competition: CompetitionId = DEFAULT_COMPETITION,
) {
  const { id } = await params;
  const data = await getTeamServer(id, competition);
  if (!data) notFound();

  const comp = competition;
  const config = COMPETITIONS[comp];
  const leagueMode = config.format === "league";
  const { team, recent_form, group_id, group_name } = data;
  const links = competitionLinks(comp);
  const now = new Date();

  const [groups, group, allMatches, tournament] = await Promise.all([
    leagueMode ? getGroupsServer(comp).catch(() => null) : Promise.resolve(null),
    !leagueMode && group_id ? getGroupServer(group_id, comp).catch(() => null) : Promise.resolve(null),
    getUpcomingMatchesServer(comp).catch(() => null),
    getCompetitionTournament(comp),
  ]);

  const fixtures = (allMatches ?? [])
    .filter((m) => m.teams.home === team.name || m.teams.away === team.name)
    .map((m) => toTeamFixture(m, comp, now));

  const season = leagueMode ? seasonLabel(tournament.year) : null;
  const eyebrow = season ? `${config.label} · ${season}` : config.label;
  const crest = leagueMode ? (
    <ClubBadge name={team.name} size={64} decorative />
  ) : (
    <TeamBadge team={team.name} size={64} decorative />
  );

  // ---- League clubs (prototype pageClub) ----
  if (leagueMode) {
    const rows: StandingRow[] =
      groups && groups.length === 1 ? dedupeStandings(groups[0].standings ?? []) : [];
    const idx = rows.findIndex((r) => r.team_id === team.id);
    const row = idx >= 0 ? rows[idx] : null;
    const tally = row
      ? {
          won: row.won ?? 0,
          drawn: row.drawn ?? 0,
          lost: row.lost ?? 0,
          gf: row.projected_goals_for,
          ga: row.goals_against ?? 0,
          played: row.played ?? 0,
        }
      : tallyFromFixtures(fixtures, team.name);
    const place = comp === "ucl" ? "the league phase" : "the table";
    const sub = row
      ? `${ordinal(idx + 1)} in ${place} with ${row.projected_points} point${row.projected_points === 1 ? "" : "s"} after ${tally.played} match${tally.played === 1 ? "" : "es"}.`
      : `Not in ${place} yet.`;

    return (
      <div>
        <PageHead
          back={{ href: links.table, label: links.tableLabel }}
          leading={crest}
          eyebrow={eyebrow}
          title={team.name}
          sub={sub}
        />
        <PageLayout>
          <Main>
            <Card pad aria-labelledby="season-so-far">
              <CardHead id="season-so-far" title="Season so far" />
              {tally.played > 0 ? (
                <StatGrid className="grid-cols-2 min-[900px]:grid-cols-4">
                  <Stat value={tally.won} label="won" />
                  <Stat value={tally.drawn} label="drawn" />
                  <Stat value={tally.lost} label="lost" />
                  <Stat value={`${tally.gf}–${tally.ga}`} label="goals for and against" />
                </StatGrid>
              ) : (
                <Note className="mt-3">No matches played yet this season.</Note>
              )}
              {recent_form.length > 0 && (
                <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-soft pt-5">
                  <span className="text-notes text-muted">Last five</span>
                  <FormStrip form={recent_form} limit={5} />
                </div>
              )}
            </Card>
            <Card flush aria-labelledby="club-matches">
              <DayBand as="h2" id="club-matches">
                Last result and next matches
              </DayBand>
              <TeamFixtures
                // Only the rows the list shows cross to the client.
                matches={selectTeamFixtures(fixtures, { now: now.getTime() })}
                teamName={team.name}
                competition={comp}
                matchBasePath={`${config.basePath}/match`}
                badge="club"
                now={now.toISOString()}
              />
            </Card>
          </Main>
          <Rail aria-label="Table">
            <MiniTableCard competition={comp} />
          </Rail>
        </PageLayout>
      </div>
    );
  }

  // ---- National teams in a finished tournament (World Cup archive) ----
  const groupRows = dedupeStandings(group?.standings ?? []);
  const gIdx = groupRows.findIndex((r) => r.team_id === team.id);
  const groupLabel = group_name ? (/^group\b/i.test(group_name) ? group_name : `Group ${group_name}`) : null;
  const tally = tallyFromFixtures(fixtures, team.name);
  const outcome = tournamentOutcome(fixtures, team.name);
  const groupLine =
    gIdx >= 0 && groupLabel
      ? `${ordinal(gIdx + 1)} in ${groupLabel} with ${groupRows[gIdx].projected_points} points.`
      : null;
  const sub = [groupLine, outcome].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <PageHead
        back={{ href: links.table, label: links.tableLabel }}
        leading={crest}
        eyebrow={eyebrow}
        title={team.name}
        sub={sub}
      />
      <PageLayout>
        <Main>
          {tally.played > 0 && (
            <Card pad aria-labelledby="tournament-stats">
              <CardHead id="tournament-stats" title="The tournament" />
              <StatGrid className="grid-cols-2 min-[900px]:grid-cols-4">
                <Stat value={tally.won} label="won" />
                <Stat value={tally.drawn} label="drawn" />
                <Stat value={tally.lost} label="lost" />
                <Stat value={`${tally.gf}–${tally.ga}`} label="goals for and against" />
              </StatGrid>
              <Note className="mt-5">A draw includes matches settled on penalties.</Note>
            </Card>
          )}
          <Card flush aria-labelledby="team-results">
            <DayBand as="h2" id="team-results">
              Results
            </DayBand>
            <TeamFixtures
              matches={fixtures}
              teamName={team.name}
              competition={comp}
              matchBasePath={`${config.basePath}/match`}
              badge="flag"
              all
              now={now.toISOString()}
            />
          </Card>
        </Main>
        {groupRows.length > 0 && groupLabel && (
          <Rail aria-label={groupLabel}>
            <Card pad aria-labelledby="team-group">
              <CardHead
                id="team-group"
                title={groupLabel}
                action={group_id ? <TextLink href={`${config.basePath}/groups/${group_id}`}>Group page</TextLink> : undefined}
              />
              <div className="mt-2">
                <StandingsTable
                  standings={groupRows}
                  zones={[]}
                  highlightTeamId={team.id}
                  teamBasePath={`${config.basePath}/team`}
                  teamHeader="Team"
                  columns={["played", "gd", "pts"]}
                  caption={`${groupLabel} final table`}
                />
              </div>
            </Card>
          </Rail>
        )}
      </PageLayout>
    </div>
  );
}

export default async function TeamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return renderTeamPage(params);
}
