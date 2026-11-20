/** StandingsClient's pre-draw honesty: a league-format competition ships its
 *  table group before the draw (the UCL league phase all summer), and zero
 *  rows must read as "no draw yet" — not as a broken bare table under a
 *  subtitle claiming live updates. */
import { render, screen } from "@testing-library/react";
import { StandingsClient } from "@/components/StandingsClient";
import { getGroups } from "@/lib/api";
import type { ActiveTournament, Group, StandingRow } from "@/lib/types";

jest.mock("@/lib/api");
const mockGroups = getGroups as jest.MockedFunction<typeof getGroups>;

const ucl: ActiveTournament = {
  id: 5,
  name: "UEFA Champions League 2026-27",
  year: 2026,
  format: "league",
  has_brackets: false,
};

const epl: ActiveTournament = {
  id: 6,
  name: "Premier League 2026-27",
  year: 2026,
  format: "league",
  has_brackets: false,
};

const row = (over: Partial<StandingRow> = {}): StandingRow => ({
  team_id: 1,
  team: "Arsenal",
  projected_points: 9,
  projected_goals_for: 7,
  projected_goal_diff: 5,
  qualification_prob: 0.92,
  ...over,
});

afterEach(() => jest.resetAllMocks());

it("renders an honest pre-draw state instead of a bare table when the group has no rows", async () => {
  const empty: Group[] = [{ id: 16, name: "Champions League", standings: [] }];
  mockGroups.mockResolvedValue(empty);
  render(<StandingsClient comp="ucl" initialGroups={empty} tournament={ucl} />);

  expect(
    await screen.findByText(/fills in once the UEFA Champions League draw is made/),
  ).toBeInTheDocument();
  expect(
    screen.getByText("The table appears here once the draw is made and fixtures load."),
  ).toBeInTheDocument();
  // No bare column header, no orphan zone legend, no live-updates claim.
  expect(screen.queryByRole("columnheader")).toBeNull();
  expect(screen.queryByText("Round of 16")).toBeNull();
  expect(screen.queryByText(/Choose a club/)).toBeNull();
});

it("renders the table and the played-so-far subtitle once rows exist", async () => {
  const groups: Group[] = [{ id: 16, name: "Champions League", standings: [row()] }];
  mockGroups.mockResolvedValue(groups);
  render(<StandingsClient comp="ucl" initialGroups={groups} tournament={ucl} played={4} />);

  expect(await screen.findByText("Arsenal")).toBeInTheDocument();
  expect(
    screen.getByText("After 4 matchdays. Choose a club for its results and next matches."),
  ).toBeInTheDocument();
  expect(screen.getByText("UEFA Champions League · 2026–27")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "League phase" })).toBeInTheDocument();
});

it("titles a domestic league 'Table', counts matchweeks and links each club's next fixture", async () => {
  const groups: Group[] = [{ id: 17, name: "Premier League", standings: [row({ played: 10 })] }];
  mockGroups.mockResolvedValue(groups);
  render(
    <StandingsClient
      comp="epl"
      initialGroups={groups}
      tournament={epl}
      played={10}
      nextByClub={{ Arsenal: { matchId: 205, opponent: "Newcastle", home: false } }}
    />,
  );
  expect(await screen.findByRole("heading", { level: 1, name: "Table" })).toBeInTheDocument();
  expect(screen.getByText(/^After 10 matchweeks\./)).toBeInTheDocument();
  expect(screen.getByText("v Newcastle (A)").closest("a")).toHaveAttribute("href", "/football/epl/match/205");
});

it("drops a ghost duplicate row of the same club (same crest, fewer matches)", async () => {
  const groups: Group[] = [{
    id: 4,
    name: "Bundesliga",
    standings: [
      row({ team_id: 649, team: "SV 07 Elversberg", played: 9 }),
      row({ team_id: 437, team: "SV Elversberg", played: 0 }),
    ],
  }];
  mockGroups.mockResolvedValue(groups);
  render(<StandingsClient comp="bundesliga" initialGroups={groups} tournament={epl} />);
  expect(await screen.findByText("SV 07 Elversberg")).toBeInTheDocument();
  expect(screen.queryByText("SV Elversberg")).toBeNull();
});

it("labels an all-zero league table as preseason and hides finish zones", async () => {
  const groups: Group[] = [{
    id: 17,
    name: "Premier League",
    standings: [row({
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      projected_points: 0,
      projected_goals_for: 0,
      projected_goal_diff: 0,
    })],
  }];
  mockGroups.mockResolvedValue(groups);
  render(<StandingsClient comp="epl" initialGroups={groups} tournament={epl} />);

  expect(await screen.findByText("Arsenal")).toBeInTheDocument();
  expect(screen.getByText(/Season not started/)).toBeInTheDocument();
  expect(screen.queryByText(/^After \d+ matchweeks/)).toBeNull();
  expect(screen.queryByText("Champions League")).toBeNull();
  expect(screen.queryByText("Europa League")).toBeNull();
  expect(screen.queryByText("Relegation")).toBeNull();
});

it("recognizes a legacy all-zero response before the backend adds played", async () => {
  const groups: Group[] = [{
    id: 17,
    name: "Premier League",
    standings: [row({
      played: undefined,
      projected_points: 0,
      projected_goals_for: 0,
      projected_goal_diff: 0,
    })],
  }];
  mockGroups.mockResolvedValue(groups);
  render(<StandingsClient comp="epl" initialGroups={groups} tournament={epl} />);

  expect(await screen.findByText(/Season not started/)).toBeInTheDocument();
  expect(screen.queryByText("Champions League")).toBeNull();
});

it("does not call a legacy non-zero table preseason", async () => {
  const groups: Group[] = [{
    id: 17,
    name: "Premier League",
    standings: [row({ played: undefined })],
  }];
  mockGroups.mockResolvedValue(groups);
  render(<StandingsClient comp="epl" initialGroups={groups} tournament={epl} />);

  expect(await screen.findByText("Choose a club for its results and next matches.")).toBeInTheDocument();
  expect(screen.queryByText(/Season not started/)).toBeNull();
});
