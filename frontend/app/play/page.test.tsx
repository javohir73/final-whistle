/** /play ("My picks") -- server component wiring: which competition it opens
 *  on, the NRL hand-off to its own tips page, the World Cup archive, the calm
 *  "not open" state for a competition without a pick game, and that the
 *  picks list itself gets only venues from the server (never the model's
 *  call). MyPicks' own behaviour is tested in components/play/MyPicks.test. */
import { render, screen } from "@testing-library/react";
import PlayPage, { metadata } from "./page";
import { getKnockoutOddsServer, getUpcomingMatchesServer } from "@/lib/api";
import { readServerCompetition } from "@/lib/competitionServer";
import { getCompetitionTournament } from "@/lib/tournament";
import type { MatchSummary, TournamentOdds } from "@/lib/types";

jest.mock("@/lib/api");
jest.mock("@/lib/tournament", () => ({ getCompetitionTournament: jest.fn() }));
jest.mock("@/lib/competitionServer", () => ({ readServerCompetition: jest.fn() }));
const mockRedirect = jest.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
jest.mock("next/navigation", () => ({ redirect: (url: string) => mockRedirect(url) }));
jest.mock("@/components/play/MyPicks", () => ({
  MyPicks: (props: { competition: string; matchweek: number | null; venues: Record<number, string> }) => (
    <div data-testid="my-picks" data-props={JSON.stringify(props)} />
  ),
}));

const mockOdds = getKnockoutOddsServer as jest.MockedFunction<typeof getKnockoutOddsServer>;
const mockUpcoming = getUpcomingMatchesServer as jest.MockedFunction<typeof getUpcomingMatchesServer>;
const mockCurrent = readServerCompetition as jest.MockedFunction<typeof readServerCompetition>;
const mockTournament = getCompetitionTournament as jest.MockedFunction<typeof getCompetitionTournament>;

const odd = (team_id: number, team: string, win_title: number | null): TournamentOdds => ({
  team_id, team, make_knockout: null, reach_r16: null, reach_qf: null, reach_sf: null,
  reach_final: null, win_title,
});

const play = (query: Record<string, string>) => PlayPage({ searchParams: Promise.resolve(query) });
const picksProps = () => JSON.parse(screen.getByTestId("my-picks").getAttribute("data-props") ?? "{}");

beforeEach(() => {
  mockCurrent.mockResolvedValue("epl");
  mockUpcoming.mockResolvedValue([
    { match_id: 205, venue: "St James' Park", predicted_score: { home: 2, away: 1 } } as unknown as MatchSummary,
    { match_id: 206, venue: null } as unknown as MatchSummary,
  ]);
  mockOdds.mockResolvedValue([odd(1, "France", 0.15), odd(2, "Brazil", 0.18)]);
  mockTournament.mockResolvedValue({ has_brackets: true } as never);
});
afterEach(() => jest.clearAllMocks());

it("opens My picks on the visitor's current competition", async () => {
  mockCurrent.mockResolvedValue("laliga");
  render(await PlayPage({}));
  expect(picksProps()).toMatchObject({ competition: "laliga", matchweek: null });
});

it("passes ?mw= through and hands the list venues only -- never the model's call", async () => {
  render(await play({ competition: "epl", mw: "10" }));
  const props = picksProps();
  expect(props).toEqual({ competition: "epl", matchweek: 10, venues: { 205: "St James' Park" } });
  expect(JSON.stringify(props)).not.toMatch(/predicted/);
});

it("ignores a bogus ?mw=", async () => {
  render(await play({ competition: "epl", mw: "abc" }));
  expect(picksProps().matchweek).toBeNull();
});

it("still renders the list when the schedule fetch fails", async () => {
  mockUpcoming.mockRejectedValue(new Error("down"));
  render(await play({ competition: "bundesliga" }));
  expect(picksProps()).toMatchObject({ competition: "bundesliga", venues: {} });
});

it("sends NRL visitors to the NRL tips page", async () => {
  await expect(play({ competition: "nrl" })).rejects.toThrow("NEXT_REDIRECT /nrl/tips");
});

it("says picks are not open for a competition without a pick game (the Champions League)", async () => {
  render(await play({ competition: "ucl" }));
  expect(screen.getByRole("heading", { name: "Picks are not open for this competition" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "See its matches" })).toHaveAttribute("href", "/football/ucl");
  expect(screen.queryByTestId("my-picks")).toBeNull();
});

it("keeps the World Cup as a finished archive with the bracket and its champion", async () => {
  render(await play({ competition: "wc26" }));
  expect(screen.getByText("World Cup 2026 · Past tournament")).toBeInTheDocument();
  expect(screen.getByText(/The World Cup is over/)).toBeInTheDocument();
  expect(screen.getByText("Brazil")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "See the bracket" })).toHaveAttribute("href", "/football/wc26/bracket");
  expect(screen.getByRole("link", { name: "Bracket leaderboard" })).toHaveAttribute(
    "href",
    "/leaderboard?competition=wc26",
  );
  expect(screen.queryByTestId("my-picks")).toBeNull();
});

it("degrades the World Cup bracket card to a plain link when no odds load", async () => {
  mockOdds.mockRejectedValue(new Error("down"));
  render(await play({ competition: "wc26" }));
  expect(screen.getByText("The model’s path through the knockouts.")).toBeInTheDocument();
});

it("is titled for picks", () => {
  expect(String(metadata.title)).toMatch(/My picks/);
});

it("sends a crafted ?competition=ufc to the UFC section, which has no picks game", async () => {
  await expect(play({ competition: "ufc" })).rejects.toThrow("NEXT_REDIRECT /ufc");
});
