/** Server half of the matchweek home: which round it opens on, the round
 *  navigation, and -- the reveal rule -- that open fixtures leave the server
 *  without the model's call (only kicked-off/finished ones, or a competition
 *  with no pick game, carry it). */
import type { ReactElement } from "react";
import { MatchweekPage, roundParam } from "@/components/matchweek/MatchweekPage";
import type { MatchweekViewProps } from "@/components/matchweek/MatchweekView";
import { getUpcomingMatchesServer } from "@/lib/api";
import { getCompetitionTournament } from "@/lib/tournament";
import type { MatchSummary } from "@/lib/types";

jest.mock("@/lib/api");
jest.mock("@/lib/tournament", () => ({ getCompetitionTournament: jest.fn() }));
jest.mock("@/components/matchweek/MatchweekView", () => ({ MatchweekView: () => null }));
const mockMatches = getUpcomingMatchesServer as jest.MockedFunction<typeof getUpcomingMatchesServer>;
const mockTournament = getCompetitionTournament as jest.MockedFunction<typeof getCompetitionTournament>;

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();
function m(id: number, mw: number, over: Partial<MatchSummary> = {}): MatchSummary {
  return {
    match_id: id, stage: "group", group: null, kickoff_utc: at(1), venue: null, venue_city: null,
    venue_country: null, is_neutral: false, status: "scheduled", score_home: null, score_away: null,
    minute: null, period: null, injury_time: null, penalty_home: null, penalty_away: null, goal_events: [],
    teams: { home: "A", away: "B" }, predicted_winner: "A", confidence: "High",
    probabilities: { home_win: 0.5, draw: 0.3, away_win: 0.2 },
    predicted_score: { home: 2, away: 0, probability: 0.1 }, matchweek: mw, ...over,
  };
}
const SEASON = [
  m(1, 10, { status: "finished", score_home: 1, score_away: 0, kickoff_utc: at(-10) }),
  m(2, 11, { kickoff_utc: at(1) }),
  m(3, 11, { kickoff_utc: at(2) }),
  m(4, 12, { kickoff_utc: at(8) }),
];

beforeEach(() => {
  mockMatches.mockResolvedValue(SEASON);
  mockTournament.mockResolvedValue({ id: 2, name: "Premier League 2026-27", year: 2026, format: "league", has_brackets: false });
});

const viewProps = async (round?: string | null, competition: "epl" | "ucl" = "epl") =>
  ((await MatchweekPage({ competition, round })) as ReactElement<MatchweekViewProps>).props;

it("opens on the current matchweek with the season in the eyebrow", async () => {
  const p = await viewProps();
  expect(p.round.title).toBe("Matchweek 11");
  expect(p.eyebrow).toBe("Premier League · 2026–27");
  expect(p.prev).toEqual({ title: "Matchweek 10", href: "/football/epl?mw=10" });
  expect(p.next).toEqual({ title: "Matchweek 12", href: "/football/epl?mw=12" });
  expect(p.fixturesHref).toBe("/football/epl");
  expect(p.resultsHref).toBe("/football/epl?mw=10");
});

it("strips the model's call from open fixtures before they reach the page", async () => {
  const p = await viewProps();
  for (const match of p.round.matches) {
    expect(match.predicted_score).toBeNull();
    expect(match.probabilities).toBeNull();
    expect(match.predicted_winner).toBeNull();
    expect(match.confidence).toBeNull();
  }
});

it("keeps it on finished fixtures", async () => {
  const p = await viewProps("10");
  expect(p.round.title).toBe("Matchweek 10");
  expect(p.round.matches[0].predicted_score).toEqual({ home: 2, away: 0, probability: 0.1 });
  expect(p.prev).toBeNull();
});

it("keeps it where there is no pick game (Champions League)", async () => {
  const p = await viewProps(null, "ucl");
  expect(p.round.title).toBe("Matchday 11");
  expect(p.round.matches[0].predicted_score).not.toBeNull();
});

it("falls back to the current round for an unknown ?mw=", async () => {
  expect((await viewProps("99")).round.key).toBe("11");
});

it("sanitises the query value", () => {
  expect(roundParam("12")).toBe("12");
  expect(roundParam(["final", "x"])).toBe("final");
  expect(roundParam("<script>")).toBeNull();
  expect(roundParam(undefined)).toBeNull();
});
