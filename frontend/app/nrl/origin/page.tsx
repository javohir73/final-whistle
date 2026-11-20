import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getOriginSeriesServer } from "@/lib/api";
import { ClubBadge } from "@/components/ClubBadge";
import { Card, CardHead, Chip, FixturePair, FixtureRow, PageHead, Stat, StatGrid, TextLink } from "@/components/ui";
import { nrlDayMonth, nrlTimeLabel, wholePct } from "@/lib/nrlDisplay";
import type { OriginGame, OriginSeriesResponse } from "@/lib/types";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "State of Origin predictions — FinalWhistle",
  description:
    "NSW Blues vs QLD Maroons — series score, per-game model predictions and series-winner odds from the FinalWhistle Elo model.",
};

const short = (side: string | null) => (side ?? "TBC").replace(/^(NSW|QLD) /, "");
const played = (g: OriginGame) => g.status === "finished" && g.score_home != null && g.score_away != null;

function gameWinner(g: OriginGame): string | null {
  if (!played(g) || g.score_home === g.score_away) return null;
  return g.score_home! > g.score_away! ? g.home : g.away;
}

/** One plain sentence under the title, from the series state the API returns. */
function seriesSub(series: OriginSeriesResponse): string {
  const { games, series: s } = series;
  const done = games.filter(played);
  const noCalls = games.every((g) => !g.prediction);
  const modelLine = noCalls ? " The model did not make calls on Origin games." : "";
  if (s.winner === "drawn") return `The series was drawn.${modelLine}`;
  if (s.winner) {
    // The game in which the winner reached its series-winning tally.
    const target = Math.max(s.blues_wins, s.maroons_wins);
    let wins = 0;
    let clincher: OriginGame | null = null;
    for (const g of done) {
      if (gameWinner(g) === s.winner && ++wins === target) {
        clincher = g;
        break;
      }
    }
    const where = clincher?.venue ? ` at ${clincher.venue}` : "";
    const which = clincher
      ? clincher === games[games.length - 1] && games.length === 3
        ? ` in the decider${where}`
        : ` in Game ${clincher.round ?? clincher.match_no}${where}`
      : "";
    const name = s.winner === "NSW Blues" ? "New South Wales" : s.winner === "QLD Maroons" ? "Queensland" : s.winner;
    return `${name} took the series${which}.${modelLine}`;
  }
  const next = games.find((g) => !played(g));
  if (next) {
    const when = nrlDayMonth(next.kickoff_utc);
    return `Game ${next.round ?? next.match_no} is ${when ? `on ${when}` : "still to be played"}${next.venue ? ` at ${next.venue}` : ""}.`;
  }
  return "The series is under way.";
}

function GameRow({ game }: { game: OriginGame }) {
  const isPlayed = played(game);
  const winner = gameWinner(game);
  const p = game.prediction;
  // Origin has no tipping game, so the model's call is public; on a game still
  // to come we show the kick-off only and keep the numbers for the odds card.
  const fav = p && isPlayed && p.p_home !== p.p_away ? (p.p_home > p.p_away ? game.home : game.away) : null;
  const favProb = p ? Math.max(p.p_home, p.p_away) : null;
  const n = game.round ?? game.match_no;
  const date = nrlDayMonth(game.kickoff_utc);
  return (
    <FixtureRow
      left={
        <>
          Game {n}
          {date ? ` · ${date}` : ""}
          {game.venue ? (
            <>
              <br />
              {game.venue}
              {game.neutral ? " (neutral)" : ""}
            </>
          ) : null}
        </>
      }
      label={
        isPlayed
          ? `Game ${n}: ${game.home} ${game.score_home}–${game.score_away} ${game.away}`
          : `Game ${n}: ${game.home} v ${game.away}`
      }
      home={{ name: game.home ?? "TBC", crest: <ClubBadge name={game.home} size={26} decorative /> }}
      away={{ name: game.away ?? "TBC", crest: <ClubBadge name={game.away} size={26} decorative /> }}
      score={isPlayed ? { home: game.score_home!, away: game.score_away! } : undefined}
      kickoff={nrlTimeLabel(game.kickoff_utc)}
      right={
        isPlayed ? (
          <span className="flex flex-col items-center gap-1 min-[900px]:items-end">
            <Chip>{winner ? `${short(winner)} win` : "Drawn"}</Chip>
            {fav && favProb != null ? (
              <FixturePair rows={[{ label: `Model ${short(fav)}`, value: wholePct(favProb) }]} />
            ) : null}
          </span>
        ) : null
      }
    />
  );
}

/** /nrl/origin (prototype `pageNrlOrigin`): the series score as the title,
 *  one card of games on the centred spine, series odds while a series is
 *  live, and links to earlier series. */
export default async function OriginPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season } = await searchParams;
  const seasonNum = season && /^\d{4}$/.test(season) ? Number(season) : undefined;
  const series = await getOriginSeriesServer(seasonNum).catch(() => null);
  if (!series) notFound();

  const s = series.series;
  const latest = series.seasons[0];
  const earlier = series.seasons.filter((y) => y !== series.season).slice(0, 6);

  return (
    <>
      <PageHead
        back={{ href: "/nrl", label: "NRL" }}
        eyebrow={`State of Origin · ${series.season}`}
        title={
          <>
            NSW Blues{" "}
            <span className="whitespace-nowrap">
              {s.blues_wins}–{s.maroons_wins}
            </span>{" "}
            QLD Maroons
          </>
        }
        sub={seriesSub(series)}
      />
      <div className="flex max-w-[980px] flex-col gap-6">
        <Card flush aria-label="State of Origin games">
          {series.games.map((g) => (
            <GameRow key={g.match_no} game={g} />
          ))}
        </Card>

        {s.odds && !s.winner ? (
          <Card pad aria-labelledby="origin-odds">
            <CardHead id="origin-odds" title="Who the model thinks wins the series" />
            <StatGrid>
              <Stat value={wholePct(s.odds.blues)} label="NSW Blues" />
              <Stat value={wholePct(s.odds.maroons)} label="QLD Maroons" />
              {s.odds.drawn > 0 ? <Stat value={wholePct(s.odds.drawn)} label="Series drawn" /> : null}
            </StatGrid>
          </Card>
        ) : null}

        {earlier.length > 0 ? (
          <nav aria-label="Earlier series" className="flex flex-wrap items-center text-notes text-muted">
            <span className="mr-1">Earlier series:</span>
            {earlier.map((y, i) => (
              <span key={y} className="inline-flex items-center">
                {i > 0 ? <span aria-hidden="true">·</span> : null}
                {/* 44 px tall tap target (padding), same brand text link look. */}
                <TextLink className="min-h-11 px-2" href={y === latest ? "/nrl/origin" : `/nrl/origin?season=${y}`}>
                  {y}
                </TextLink>
              </span>
            ))}
          </nav>
        ) : null}
      </div>
    </>
  );
}
