import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { LeagueTipsLeaderboard } from "./LeagueTipsLeaderboard";
import { getLeagueSeasonLeaderboard, getLeagueTipsLeaderboard } from "@/lib/leagueTips";
import { reportViewerHandle, resetViewerHandleForTests } from "@/components/play/viewerHandle";

jest.mock("@/lib/leagueTips");

const mockLeaderboard = getLeagueTipsLeaderboard as jest.MockedFunction<typeof getLeagueTipsLeaderboard>;
const mockSeasonLeaderboard = getLeagueSeasonLeaderboard as jest.MockedFunction<typeof getLeagueSeasonLeaderboard>;

afterEach(() => {
  jest.resetAllMocks();
  act(() => resetViewerHandleForTests());
});

const MODEL = "FinalWhistle model";

it("falls back to a quiet participant count when an older API withholds the rows", async () => {
  mockLeaderboard.mockResolvedValue({ league: "epl", matchweek: 1, participant_count: 9, entries: [] });

  render(<LeagueTipsLeaderboard league="epl" matchweek={1} />);
  expect(await screen.findByText("9 playing this matchweek")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

it("renders the ranked list with the exact-count tiebreak column once the matchweek hits the gate", async () => {
  mockLeaderboard.mockResolvedValue({
    league: "epl", matchweek: 1, participant_count: 10,
    entries: [{ handle: "SwiftStriker42", points: 7, exact_count: 2 }],
  });

  render(<LeagueTipsLeaderboard league="epl" matchweek={1} />);
  expect(await screen.findByRole("table")).toBeInTheDocument();
  expect(screen.getByText("SwiftStriker42")).toBeInTheDocument();
  expect(screen.getByText("7")).toBeInTheDocument();
  expect(screen.getByText("Exact")).toBeInTheDocument();
  expect(screen.getByText("2")).toBeInTheDocument();
});

it("never fetches the season endpoint before the Season tab is opened", async () => {
  mockLeaderboard.mockResolvedValue({ league: "epl", matchweek: 1, participant_count: 9, entries: [] });

  render(<LeagueTipsLeaderboard league="epl" matchweek={1} />);
  await screen.findByText("9 playing this matchweek");
  expect(mockSeasonLeaderboard).not.toHaveBeenCalled();
});

it("shows a quiet season participant count below the season gate -- no empty table", async () => {
  mockLeaderboard.mockResolvedValue({ league: "epl", matchweek: 1, participant_count: 9, entries: [] });
  mockSeasonLeaderboard.mockResolvedValue({ league: "epl", participant_count: 6, entries: [] });

  render(<LeagueTipsLeaderboard league="epl" matchweek={1} />);
  await screen.findByText("9 playing this matchweek");

  fireEvent.click(screen.getByRole("button", { name: "Season" }));
  expect(mockSeasonLeaderboard).toHaveBeenCalledWith("epl");
  expect(await screen.findByText("6 playing this season")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

it("renders the season-long ranked list, matchweeks_played included, once the season hits the gate", async () => {
  mockLeaderboard.mockResolvedValue({ league: "epl", matchweek: 1, participant_count: 9, entries: [] });
  mockSeasonLeaderboard.mockResolvedValue({
    league: "epl", participant_count: 12,
    entries: [{ handle: "SwiftStriker123", points: 14, exact_count: 3, matchweeks_played: 6 }],
  });

  render(<LeagueTipsLeaderboard league="epl" matchweek={1} />);
  await screen.findByText("9 playing this matchweek");

  fireEvent.click(screen.getByRole("button", { name: "Season" }));
  expect(await screen.findByRole("table")).toBeInTheDocument();
  expect(screen.getByText("SwiftStriker123")).toBeInTheDocument();
  expect(screen.getByText("14")).toBeInTheDocument();
  expect(screen.getByText("3")).toBeInTheDocument();
  expect(screen.getByText("6")).toBeInTheDocument();
});

it("switches back to the weekly board without re-fetching it", async () => {
  mockLeaderboard.mockResolvedValue({
    league: "epl", matchweek: 1, participant_count: 10,
    entries: [{ handle: "SwiftStriker42", points: 7, exact_count: 1 }],
  });
  mockSeasonLeaderboard.mockResolvedValue({ league: "epl", participant_count: 6, entries: [] });

  render(<LeagueTipsLeaderboard league="epl" matchweek={1} />);
  await screen.findByRole("table");

  fireEvent.click(screen.getByRole("button", { name: "Season" }));
  await screen.findByText("6 playing this season");

  fireEvent.click(screen.getByRole("button", { name: "Weekly" }));
  expect(await screen.findByText("SwiftStriker42")).toBeInTheDocument();
  expect(mockLeaderboard).toHaveBeenCalledTimes(1);
});

it("re-fetches the weekly board when the matchweek prop changes", async () => {
  mockLeaderboard.mockResolvedValueOnce({ league: "epl", matchweek: 1, participant_count: 9, entries: [] });
  mockLeaderboard.mockResolvedValueOnce({ league: "epl", matchweek: 2, participant_count: 11, entries: [] });

  const { rerender } = render(<LeagueTipsLeaderboard league="epl" matchweek={1} />);
  await screen.findByText("9 playing this matchweek");

  rerender(<LeagueTipsLeaderboard league="epl" matchweek={2} />);
  expect(await screen.findByText("11 playing this matchweek")).toBeInTheDocument();
  expect(mockLeaderboard).toHaveBeenCalledWith("epl", 2);
});

it("supports a season-only You view without fetching a guessed matchweek", async () => {
  mockSeasonLeaderboard.mockResolvedValue({ league: "laliga", participant_count: 0, entries: [] });

  render(<LeagueTipsLeaderboard league="laliga" seasonOnly />);

  expect(await screen.findByText(/No graded picks yet this season/)).toBeInTheDocument();
  expect(mockSeasonLeaderboard).toHaveBeenCalledWith("laliga");
  expect(mockLeaderboard).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Weekly" })).toBeNull();
});

// ---- The model as a ranked row (C2-2) ---------------------------------------

it("ranks the model among the players, badged, with no device actions", async () => {
  mockLeaderboard.mockResolvedValue({
    league: "epl", matchweek: 10, participant_count: 1,
    entries: [
      { handle: "SoloPlayer", points: 5, exact_count: 1, is_model: false },
      { handle: MODEL, points: 2, exact_count: 0, is_model: true },
    ] as never,
  });

  render(<LeagueTipsLeaderboard league="epl" matchweek={10} />);

  const rows = (await screen.findAllByRole("row")).slice(1); // drop the header
  expect(rows).toHaveLength(2);
  expect(within(rows[1]).getByText("2", { selector: "td:first-child" })).toBeInTheDocument();
  expect(within(rows[1]).getByText(MODEL)).toBeInTheDocument();
  expect(within(rows[1]).getByText("Model")).toBeInTheDocument();
  expect(within(rows[1]).queryByRole("button")).toBeNull();
  expect(within(rows[1]).queryByRole("link")).toBeNull();
  expect(within(rows[0]).queryByText("Model")).toBeNull();
});

it("shows a one-player board instead of hiding it below ten players", async () => {
  mockLeaderboard.mockResolvedValue({
    league: "laliga", matchweek: 11, participant_count: 1,
    entries: [
      { handle: MODEL, points: 0, exact_count: 0, is_model: true },
      { handle: "LoneWolf", points: 0, exact_count: 0, is_model: false },
    ] as never,
  });

  render(<LeagueTipsLeaderboard league="laliga" matchweek={11} />);
  expect(await screen.findByText("LoneWolf")).toBeInTheDocument();
  expect(screen.queryByText(/playing this matchweek/)).not.toBeInTheDocument();
});

it("tells the viewer they are beating the model, and marks their row", async () => {
  mockLeaderboard.mockResolvedValue({
    league: "epl", matchweek: 10, participant_count: 2,
    entries: [
      { handle: "SoloPlayer", points: 5, exact_count: 1, is_model: false },
      { handle: MODEL, points: 2, exact_count: 0, is_model: true },
      { handle: "Other", points: 0, exact_count: 0, is_model: false },
    ] as never,
  });

  render(<LeagueTipsLeaderboard league="epl" matchweek={10} viewerHandle="SoloPlayer" />);

  expect(await screen.findByText("You're beating the model by 3 pts this matchweek")).toBeInTheDocument();
  const viewerRow = screen.getByText("SoloPlayer").closest("tr")!;
  expect(within(viewerRow).getByText("You")).toBeInTheDocument();
});

it("tells the viewer by how much the model leads on the season board", async () => {
  mockSeasonLeaderboard.mockResolvedValue({
    league: "epl", participant_count: 1,
    entries: [
      { handle: MODEL, points: 7, exact_count: 1, matchweeks_played: 3, is_model: true },
      { handle: "SeasonSolo", points: 2, exact_count: 0, matchweeks_played: 1, is_model: false },
    ] as never,
  });

  render(<LeagueTipsLeaderboard league="epl" seasonOnly viewerHandle="SeasonSolo" />);

  expect(await screen.findByText("The model leads you by 5 pts this season")).toBeInTheDocument();
  // The model's own matchweeks column renders like any other row.
  expect(screen.getByText("3")).toBeInTheDocument();
});

it("says so when the viewer is level with the model", async () => {
  mockLeaderboard.mockResolvedValue({
    league: "epl", matchweek: 10, participant_count: 1,
    entries: [
      { handle: "Even", points: 2, exact_count: 0, is_model: false },
      { handle: MODEL, points: 2, exact_count: 0, is_model: true },
    ] as never,
  });

  render(<LeagueTipsLeaderboard league="epl" matchweek={10} viewerHandle="Even" />);
  expect(await screen.findByText("You're level with the model this matchweek")).toBeInTheDocument();
});

it("learns the viewer's handle from whichever tips surface reported it", async () => {
  mockLeaderboard.mockResolvedValue({
    league: "epl", matchweek: 10, participant_count: 1,
    entries: [
      { handle: MODEL, points: 5, exact_count: 1, is_model: true },
      { handle: "SwiftStriker42", points: 2, exact_count: 0, is_model: false },
    ] as never,
  });

  render(<LeagueTipsLeaderboard league="epl" matchweek={10} />);
  await screen.findByText("SwiftStriker42");
  expect(screen.queryByText(/the model/i, { selector: "p" })).not.toBeInTheDocument();

  act(() => reportViewerHandle("SwiftStriker42"));
  expect(await screen.findByText("The model leads you by 3 pts this matchweek")).toBeInTheDocument();
});

it("adds no summary line for a viewer who isn't on the board", async () => {
  mockLeaderboard.mockResolvedValue({
    league: "epl", matchweek: 10, participant_count: 1,
    entries: [
      { handle: "SoloPlayer", points: 5, exact_count: 1, is_model: false },
      { handle: MODEL, points: 2, exact_count: 0, is_model: true },
    ] as never,
  });

  render(<LeagueTipsLeaderboard league="epl" matchweek={10} viewerHandle="Stranger" />);
  await screen.findByText("SoloPlayer");
  expect(screen.queryByText(/beating the model|leads you|level with the model/)).not.toBeInTheDocument();
});

it("keeps an honest empty state when nobody has played -- even with the model row present", async () => {
  mockLeaderboard.mockResolvedValue({
    league: "bundesliga", matchweek: 10, participant_count: 0,
    entries: [{ handle: MODEL, points: 0, exact_count: 0, is_model: true }] as never,
  });

  render(<LeagueTipsLeaderboard league="bundesliga" matchweek={10} />);
  expect(await screen.findByText(/No one has played this matchweek yet/)).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

it("names the model's tally on an empty season board", async () => {
  mockSeasonLeaderboard.mockResolvedValue({
    league: "bundesliga", participant_count: 0,
    entries: [{ handle: MODEL, points: 21, exact_count: 2, matchweeks_played: 9, is_model: true }] as never,
  });

  render(<LeagueTipsLeaderboard league="bundesliga" seasonOnly />);
  expect(await screen.findByText(/The model has 21 pts so far\./)).toBeInTheDocument();
});
