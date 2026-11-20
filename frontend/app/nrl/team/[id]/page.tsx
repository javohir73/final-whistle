import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getNrlLadderServer, getNrlMatchesServer, getNrlTeamServer } from "@/lib/api";
import { APP_NAME } from "@/lib/constants";
import { ClubBadge } from "@/components/ClubBadge";
import {
  Card,
  CardHead,
  Chip,
  DayBand,
  FixtureRow,
  Main,
  Note,
  PageHead,
  PageLayout,
  Rail,
  Stat,
  StatGrid,
} from "@/components/ui";
import { LadderCard } from "@/components/nrl/LadderCard";
import { NrlFinalsCard } from "@/components/nrl/NrlRoundCard";
import { nrlMatchHref } from "@/lib/nrlAdapters";
import {
  nrlDayMonth,
  nrlFinalsRounds,
  nrlGrandFinal,
  nrlTimeLabel,
  nrlWinner,
  ordinal,
  signedNumber,
} from "@/lib/nrlDisplay";
import { nrlSeasonState } from "@/lib/nrlTips";
import type { NrlTeamFixture, NrlTeamResult } from "@/lib/types";

export const revalidate = 60; // ISR window: rendered on demand, then served from the CDN for 60 s
// No paths are prebuilt (the competition/id space is data-driven); an empty
// list is what switches this dynamic segment from per-request rendering to ISR.
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return { title: `Club — ${APP_NAME}` };
  const data = await getNrlTeamServer(id).catch(() => null);
  if (!data) return { title: `Club — ${APP_NAME}` };
  const { team, ladder, summary, season } = data;
  const title = `${team.name} — NRL ${season} club profile | ${APP_NAME}`;
  const standing = [
    ladder ? `${ordinal(ladder.rank)} on the ladder` : null,
    summary ? `${summary.wins}–${summary.losses}–${summary.draws} record` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const description =
    `${team.name} in the ${season} NRL season` +
    `${standing ? ` — ${standing}` : ""}. Results, finals and the FinalWhistle model's record on the club.`;
  return {
    title,
    description,
    alternates: { canonical: `/nrl/team/${id}` },
    openGraph: { title, description },
  };
}

/** NRL club page (prototype `pageNrlClub`): crest + name, where the club
 *  finished, the season in three numbers, then its finals (or, in season, the
 *  next matches and recent results), and the ladder in the rail. */
export default async function NrlTeamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const [data, fixtures, ladder] = await Promise.all([
    getNrlTeamServer(id),
    getNrlMatchesServer().catch(() => null),
    getNrlLadderServer().catch(() => null),
  ]);
  if (!data) notFound();
  const { team, season, results, upcoming, model, disclaimer } = data;
  const row = data.ladder;

  const complete = fixtures ? nrlSeasonState(fixtures.rounds) === "complete" : false;
  const gf = fixtures ? nrlGrandFinal(fixtures.rounds) : null;
  const premiers = gf ? nrlWinner(gf.match) === team.name : false;
  const isClub = (m: { home_team_id: number | null; away_team_id: number | null; home: string | null; away: string | null }) =>
    m.home_team_id === team.id || m.away_team_id === team.id || m.home === team.name || m.away === team.name;
  const finals = (fixtures ? nrlFinalsRounds(fixtures.rounds) : [])
    .map((f) => ({ ...f, matches: f.matches.filter(isClub) }))
    .filter((f) => f.matches.length > 0);

  const sub = row
    ? complete
      ? `Finished ${ordinal(row.rank)} on the ladder with ${row.points} points.${premiers ? ` ${season} premiers.` : ""}`
      : `${ordinal(row.rank)} on the ladder with ${row.points} points after ${row.played} matches.`
    : `No ladder position yet for ${season}.`;

  return (
    <>
      <PageHead
        back={{ href: "/nrl/ladder", label: "Ladder" }}
        leading={<ClubBadge name={team.name} size={64} decorative />}
        eyebrow={`NRL · ${season} season`}
        title={team.name}
        sub={sub}
      />
      <PageLayout>
        <Main>
          {row ? (
            <Card pad aria-labelledby="club-season">
              <CardHead id="club-season" title={`${season} season`} />
              <StatGrid>
                <Stat value={row.wins} label="won" />
                {row.draws > 0 ? <Stat value={row.draws} label="drawn" /> : null}
                <Stat value={row.losses} label="lost" />
                <Stat value={signedNumber(row.diff)} label="points difference" />
              </StatGrid>
              {model && model.graded > 0 ? (
                <Note className="mt-5">
                  The model called {model.called} of {model.graded} of their graded matches.
                </Note>
              ) : null}
            </Card>
          ) : null}

          {finals.length > 0 && fixtures ? (
            <div>
              <h2 className="mb-3 text-h2 font-semibold text-ink">Finals</h2>
              <NrlFinalsCard finals={finals} season={fixtures.season} label={`${team.name} finals`} />
            </div>
          ) : complete && row ? (
            <Card pad aria-labelledby="club-finals">
              <CardHead id="club-finals" title="Finals" />
              <Note className="mt-1.5">
                {team.name} did not play finals in {season}.
              </Note>
            </Card>
          ) : null}

          {!complete && upcoming.length > 0 ? (
            <Card flush aria-label="Next matches">
              <DayBand as="h2">Next up</DayBand>
              {upcoming.slice(0, 3).map((f) => (
                <ClubFixtureRow key={f.id} club={team.name} fixture={f} season={season} />
              ))}
            </Card>
          ) : null}

          {!complete && results.length > 0 ? (
            <Card flush aria-label="Recent results">
              <DayBand as="h2">Recent results</DayBand>
              {results.slice(0, 5).map((r) => (
                <ClubFixtureRow key={r.id} club={team.name} fixture={r} season={season} />
              ))}
            </Card>
          ) : null}

          <p className="text-label text-muted">{disclaimer}</p>
        </Main>
        <Rail aria-label="Ladder">
          {ladder ? (
            <LadderCard
              rows={ladder.rows}
              highlightTeamId={team.id}
              title={complete ? "Final ladder" : "Ladder"}
              note={complete ? "The top eight played finals." : "The top eight make the finals."}
            />
          ) : null}
        </Rail>
      </PageLayout>
    </>
  );
}

/** A club-centric fixture or result on the centred spine. No model numbers on
 *  a match still to come (the reveal rule; this page is public); a finished
 *  one carries the ledger's "Called it" / "Missed". */
function ClubFixtureRow({
  club,
  fixture: f,
  season,
}: {
  club: string;
  fixture: NrlTeamFixture | NrlTeamResult;
  season: number;
}) {
  const opp = f.opponent ?? "TBC";
  const home = f.was_home ? club : opp;
  const away = f.was_home ? opp : club;
  const result = "score_for" in f ? f : null;
  const score = result
    ? f.was_home
      ? { home: result.score_for, away: result.score_against }
      : { home: result.score_against, away: result.score_for }
    : undefined;
  const date = nrlDayMonth(f.kickoff_utc);
  return (
    <FixtureRow
      href={nrlMatchHref(season, f.round, f.match_no) ?? undefined}
      left={
        <>
          {f.round != null ? `Round ${f.round}` : "Round TBC"}
          {date ? (
            <>
              <br />
              {date}
            </>
          ) : null}
        </>
      }
      home={{ name: home, crest: <ClubBadge name={home} size={26} decorative /> }}
      away={{ name: away, crest: <ClubBadge name={away} size={26} decorative /> }}
      score={score}
      kickoff={nrlTimeLabel(f.kickoff_utc)}
      right={
        result && result.model_called != null ? (
          <Chip tone={result.model_called ? "good" : "miss"}>{result.model_called ? "Model called it" : "Model missed"}</Chip>
        ) : null
      }
    />
  );
}
