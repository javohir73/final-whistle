/** Server half of the matchweek home: fetch the competition's season list
 *  (ISR-cached), cut it into rounds, pick the one the URL asks for (default:
 *  the current round), strip the model's call from fixtures that may not show
 *  it to everyone yet, and hand ONLY that round to the client view -- not the
 *  whole 380-row season. Used by /, /football/<comp> and /football/<comp>/fixtures. */
import { EmptyState, PageHead, Button } from "@/components/ui";
import { MatchweekView, type RoundNav } from "@/components/matchweek/MatchweekView";
import { getUpcomingMatchesServer } from "@/lib/api";
import {
  buildRounds,
  currentRoundIndex,
  knockoutWinner,
  resultsRoundIndex,
  ROUND_PARAM,
  seasonFromMatches,
  seasonFromName,
  withoutModel,
  type Round,
} from "@/lib/matchweeks";
import { canRevealModelPublicly } from "@/lib/reveal";
import { COMPETITIONS, type CompetitionId } from "@/lib/sports";
import { getCompetitionTournament } from "@/lib/tournament";

/** `?mw=` as given (a string, or the first of several), else null. */
export function roundParam(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v && /^[a-z0-9]{1,8}$/i.test(v) ? v.toLowerCase() : null;
}

function hrefFor(competition: CompetitionId, rounds: Round[], index: number, current: number): string {
  const base = COMPETITIONS[competition].basePath;
  return index === current ? base : `${base}?${ROUND_PARAM}=${encodeURIComponent(rounds[index].key)}`;
}

export async function MatchweekPage({
  competition,
  round: requested = null,
}: {
  competition: CompetitionId;
  /** The `?mw=` value; null = the current round. */
  round?: string | null;
}) {
  const config = COMPETITIONS[competition];
  const [matches, tournament] = await Promise.all([
    getUpcomingMatchesServer(competition).catch(() => null),
    getCompetitionTournament(competition),
  ]);
  const now = new Date();
  const rounds = buildRounds(competition, matches ?? []);
  const season = seasonFromName(tournament.id ? tournament.name : null) ?? seasonFromMatches(matches ?? []);
  const eyebrow = config.archived
    ? `${config.label} · Archive`
    : season
      ? `${config.label} · ${season}`
      : config.label;

  if (rounds.length === 0) {
    return (
      <>
        <PageHead eyebrow={eyebrow} title={config.label} />
        <EmptyState
          title={matches == null ? "Fixtures are unavailable right now" : "Season data is not loaded yet"}
          actions={<Button href={COMPETITIONS.epl.basePath}>Go to the Premier League</Button>}
        >
          {matches == null
            ? "We could not reach the fixtures feed. Try again in a minute."
            : `${config.label} fixtures appear here as soon as they are published.`}
        </EmptyState>
      </>
    );
  }

  const current = currentRoundIndex(rounds, now);
  const asked = requested ? rounds.findIndex((r) => r.key === requested) : -1;
  const index = asked >= 0 ? asked : current;
  const results = resultsRoundIndex(rounds, current);
  const round = rounds[index];

  const nav = (i: number): RoundNav | null =>
    i >= 0 && i < rounds.length ? { title: rounds[i].title, href: hrefFor(competition, rounds, i, current) } : null;

  // The model's call leaves the server only where everyone may see it
  // (kicked off, finished, or no pick game); the client reveals the rest
  // per viewer once a pick is locked.
  const safeRound: Round = {
    ...round,
    matches: round.matches.map((m) =>
      canRevealModelPublicly(competition, m.status, m.kickoff_utc, now) ? m : withoutModel(m),
    ),
  };

  const finalMatch = config.format === "knockout" ? rounds.find((r) => r.key === "final")?.matches.find((m) => m.stage === "final") : undefined;
  const champion = finalMatch ? knockoutWinner(finalMatch) : null;
  const archive = config.archived || current === rounds.length - 1 && rounds[current].matches.every((m) => m.status === "finished");

  return (
    <MatchweekView
      competition={competition}
      eyebrow={eyebrow}
      round={safeRound}
      prev={nav(index - 1)}
      next={nav(index + 1)}
      // An archive has no "fixtures" left to show: only the results control.
      fixturesHref={archive ? null : hrefFor(competition, rounds, current, current)}
      resultsHref={results >= 0 ? hrefFor(competition, rounds, results, current) : null}
      renderedAt={now.toISOString()}
      champion={champion}
    />
  );
}
