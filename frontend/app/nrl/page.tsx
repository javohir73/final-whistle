import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getNrlLadderServer,
  getNrlMatchesServer,
  getNrlRecordServer,
  getOriginSeriesServer,
} from "@/lib/api";
import { ChevronLeftIcon, ChevronRightIcon, Main, PageHead, PageLayout, Rail, RoundLink } from "@/components/ui";
import { GrandFinalCard } from "@/components/nrl/GrandFinalCard";
import { LadderCard } from "@/components/nrl/LadderCard";
import { ModelSeasonCard, OriginLinkCard } from "@/components/nrl/NrlHomeBlocks";
import { NrlRoundCard } from "@/components/nrl/NrlRoundCard";
import { nrlGrandFinal, nrlWinner } from "@/lib/nrlDisplay";
import { isNrlOpenMatch, nrlSeasonStart, nrlSeasonState, nrlStartLabel } from "@/lib/nrlTips";
import type { LadderResponse, NrlMatchesResponse, NrlRecord, NrlRound, OriginSeriesResponse } from "@/lib/types";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "NRL predictions — FinalWhistle",
  description: "Match predictions from the FinalWhistle model, the ladder and the model's record for the NRL season.",
};

/** NRL home, by where the season stands (lib/nrlTips.ts nrlSeasonState, the
 *  rule /play, /nrl/tips and the home page share):
 *  - complete: the Grand Final, the model's season, Origin, the final ladder
 *    (prototype `pageNrlHome`);
 *  - open / between rounds: the current (or last) round on the centred spine,
 *    with tips and the model's call behind the reveal rule;
 *  - pre-season: Round 1 of the new draw and last season's record. */
export default async function NrlHomePage() {
  const [fixtures, ladder, origin] = await Promise.all([
    getNrlMatchesServer().catch(() => null),
    getNrlLadderServer().catch(() => null),
    getOriginSeriesServer().catch(() => null),
  ]);
  if (!fixtures) notFound();

  const now = new Date();
  const seasonState = nrlSeasonState(fixtures.rounds, now);
  if (seasonState === "complete") {
    const record = await getNrlRecordServer().catch(() => null);
    return <SeasonComplete fixtures={fixtures} record={record} ladder={ladder} origin={origin} />;
  }
  if (seasonState === "pre-season") {
    const record = await getNrlRecordServer().catch(() => null);
    return <PreSeason fixtures={fixtures} record={record} origin={origin} />;
  }

  // In season: the round with something still to play, else (between rounds)
  // the last round as results -- a played round is never dressed up as open.
  const current = fixtures.rounds.find((r) => r.matches.some((m) => isNrlOpenMatch(m, now)));
  const round = current ?? lastPlayedRound(fixtures.rounds, now);
  const n = round?.round ?? null;
  const roundNumbers = fixtures.rounds.map((r) => r.round).filter((r): r is number => r != null);
  const prev = n != null && roundNumbers.includes(n - 1) ? n - 1 : null;
  const next = n != null && roundNumbers.includes(n + 1) ? n + 1 : null;

  return (
    <>
      <PageHead
        eyebrow={`NRL · ${fixtures.season} season`}
        title={n != null ? `Round ${n}` : "This round"}
        titleAside={
          n != null ? (
            <div className="flex gap-2">
              <RoundLink label={prev ? `Round ${prev}` : "No earlier round"} href={prev ? `/nrl/round/${prev}` : undefined} disabled={!prev}>
                <ChevronLeftIcon />
              </RoundLink>
              <RoundLink label={next ? `Round ${next}` : "No later round"} href={next ? `/nrl/round/${next}` : undefined} disabled={!next}>
                <ChevronRightIcon />
              </RoundLink>
            </div>
          ) : null
        }
        sub={
          current
            ? "Tip the winner of every match, one point each. The model’s call shows once you have tipped."
            : "Results from the last round. The next round’s tips open when its draw is out."
        }
      />
      <PageLayout>
        <Main>
          {round && round.matches.length > 0 ? (
            <NrlRoundCard
              season={fixtures.season}
              round={round.round}
              matches={round.matches}
              label={n != null ? `Round ${n}` : "This round"}
              tipping={!!current}
            />
          ) : null}
          <OriginLinkCard origin={origin} />
        </Main>
        <Rail aria-label="Ladder">
          {ladder ? <LadderCard rows={ladder.rows} title="Ladder" note="The top eight make the finals." /> : null}
        </Rail>
      </PageLayout>
    </>
  );
}

function lastPlayedRound(rounds: NrlRound[], now: Date): NrlRound | undefined {
  const t = now.getTime();
  for (let i = rounds.length - 1; i >= 0; i--) {
    if (rounds[i].matches.some((m) => m.status === "finished" || (m.kickoff_utc && Date.parse(m.kickoff_utc) <= t))) {
      return rounds[i];
    }
  }
  return rounds[rounds.length - 1];
}

function SeasonComplete({
  fixtures,
  record,
  ladder,
  origin,
}: {
  fixtures: NrlMatchesResponse;
  record: NrlRecord | null;
  ladder: LadderResponse | null;
  origin: OriginSeriesResponse | null;
}) {
  const season = fixtures.season;
  const gf = nrlGrandFinal(fixtures.rounds);
  const premier = gf ? nrlWinner(gf.match) : null;
  // Same words as the /nrl/tips empty state (the NRL always starts in March).
  const sub = `${premier ? `The ${premier} are premiers. ` : ""}Tips reopen for Round 1 in March ${season + 1}.`;

  return (
    <>
      <PageHead eyebrow={`NRL · ${season} season`} title="Season complete" sub={sub} />
      <PageLayout>
        <Main>
          {gf && gf.round != null ? <GrandFinalCard match={gf.match} season={season} round={gf.round} /> : null}
          {record ? <ModelSeasonCard record={record} season={season} /> : null}
          <OriginLinkCard origin={origin} />
        </Main>
        <Rail aria-label="Final ladder">{ladder ? <LadderCard rows={ladder.rows} /> : null}</Rail>
      </PageLayout>
    </>
  );
}

/** Next season's draw is loaded and Round 1 is weeks away: Round 1 on the
 *  spine (tippable), last season's record, Origin. */
function PreSeason({
  fixtures,
  record,
  origin,
}: {
  fixtures: NrlMatchesResponse;
  record: NrlRecord | null;
  origin: OriginSeriesResponse | null;
}) {
  const season = fixtures.season;
  const startIso = nrlSeasonStart(fixtures.rounds);
  const first = fixtures.rounds[0];
  return (
    <>
      <PageHead
        eyebrow={`NRL · ${season} season`}
        title={`Season ${season}`}
        sub={`Round 1 starts ${startIso ? nrlStartLabel(startIso) : "soon"}. Tip the winner of every match, one point each.`}
      />
      <PageLayout>
        <Main>
          {first && first.matches.length > 0 ? (
            <NrlRoundCard season={season} round={first.round} matches={first.matches} label="Round 1" />
          ) : null}
          {record ? <ModelSeasonCard record={record} season={season - 1} /> : null}
          <OriginLinkCard origin={origin} />
        </Main>
      </PageLayout>
    </>
  );
}
