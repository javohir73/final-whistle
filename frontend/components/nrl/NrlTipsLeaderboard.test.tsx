import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { NrlTipsLeaderboard } from "./NrlTipsLeaderboard";
import { getNrlSeasonLeaderboard, getNrlTipsLeaderboard } from "@/lib/nrlTips";
import { reportViewerHandle, resetViewerHandleForTests } from "@/components/play/viewerHandle";

jest.mock("@/lib/nrlTips");

const mockLeaderboard = getNrlTipsLeaderboard as jest.MockedFunction<typeof getNrlTipsLeaderboard>;
const mockSeasonLeaderboard = getNrlSeasonLeaderboard as jest.MockedFunction<typeof getNrlSeasonLeaderboard>;

afterEach(() => {
  jest.resetAllMocks();
  act(() => resetViewerHandleForTests());
});

const MODEL = "FinalWhistle model";

it("falls back to a quiet participant count when an older API withholds the rows", async () => {
  mockLeaderboard.mockResolvedValue({ season: 2026, round: 1, participant_count: 9, entries: [] });

  render(<NrlTipsLeaderboard season={2026} round={1} />);
  expect(await screen.findByText("9 playing this round")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

it("renders the ranked list once the round hits the gate", async () => {
  mockLeaderboard.mockResolvedValue({
    season: 2026, round: 1, participant_count: 10,
    entries: [{ handle: "SwiftHalfback482", points: 7, round_margin: 3 }],
  });

  render(<NrlTipsLeaderboard season={2026} round={1} />);
  expect(await screen.findByRole("table")).toBeInTheDocument();
  expect(screen.getByText("SwiftHalfback482")).toBeInTheDocument();
  expect(screen.getByText("7")).toBeInTheDocument();
  expect(screen.getByText("3")).toBeInTheDocument();
});

it("shows an em dash for an entry with no featured-match margin", async () => {
  mockLeaderboard.mockResolvedValue({
    season: 2026, round: 1, participant_count: 10,
    entries: [
      { handle: "SwiftHalfback482", points: 5, round_margin: 2 },
      { handle: "BraveProp7", points: 4, round_margin: null },
    ],
  });

  render(<NrlTipsLeaderboard season={2026} round={1} />);
  expect(await screen.findByText("—")).toBeInTheDocument();
});

it("drops the Margin column when nobody on the board has a margin", async () => {
  mockLeaderboard.mockResolvedValue({
    season: 2026, round: 1, participant_count: 10,
    entries: [{ handle: "BraveProp7", points: 4, round_margin: null }],
  });

  render(<NrlTipsLeaderboard season={2026} round={1} />);
  await screen.findByRole("table");
  expect(screen.queryByRole("columnheader", { name: "Margin" })).not.toBeInTheDocument();
});

it("never fetches the season endpoint before the Season tab is opened", async () => {
  mockLeaderboard.mockResolvedValue({ season: 2026, round: 1, participant_count: 9, entries: [] });

  render(<NrlTipsLeaderboard season={2026} round={1} />);
  await screen.findByText("9 playing this round");
  expect(mockSeasonLeaderboard).not.toHaveBeenCalled();
});

it("shows a quiet season participant count below the season gate -- no empty table", async () => {
  mockLeaderboard.mockResolvedValue({ season: 2026, round: 1, participant_count: 9, entries: [] });
  mockSeasonLeaderboard.mockResolvedValue({ season: 2026, participant_count: 6, entries: [] });

  render(<NrlTipsLeaderboard season={2026} round={1} />);
  await screen.findByText("9 playing this round");

  fireEvent.click(screen.getByRole("button", { name: "Season" }));
  expect(mockSeasonLeaderboard).toHaveBeenCalledWith(2026);
  expect(await screen.findByText("6 playing this season")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

it("renders the season-long ranked list, rounds_played included, once the season hits the gate", async () => {
  mockLeaderboard.mockResolvedValue({ season: 2026, round: 1, participant_count: 9, entries: [] });
  mockSeasonLeaderboard.mockResolvedValue({
    season: 2026, participant_count: 12,
    entries: [{ handle: "SwiftHalfback123", points: 14, total_margin: 37, rounds_played: 6 }],
  });

  render(<NrlTipsLeaderboard season={2026} round={1} />);
  await screen.findByText("9 playing this round");

  fireEvent.click(screen.getByRole("button", { name: "Season" }));
  expect(await screen.findByRole("table")).toBeInTheDocument();
  expect(screen.getByText("SwiftHalfback123")).toBeInTheDocument();
  expect(screen.getByText("14")).toBeInTheDocument();
  expect(screen.getByText("37")).toBeInTheDocument();
  expect(screen.getByText("6")).toBeInTheDocument();
});

it("switches back to the weekly board without re-fetching it", async () => {
  mockLeaderboard.mockResolvedValue({
    season: 2026, round: 1, participant_count: 10,
    entries: [{ handle: "SwiftHalfback482", points: 7, round_margin: 3 }],
  });
  mockSeasonLeaderboard.mockResolvedValue({ season: 2026, participant_count: 6, entries: [] });

  render(<NrlTipsLeaderboard season={2026} round={1} />);
  await screen.findByRole("table");

  fireEvent.click(screen.getByRole("button", { name: "Season" }));
  await screen.findByText("6 playing this season");

  fireEvent.click(screen.getByRole("button", { name: "Weekly" }));
  expect(await screen.findByText("SwiftHalfback482")).toBeInTheDocument();
  expect(mockLeaderboard).toHaveBeenCalledTimes(1);
});

it("supports a season-only You view without fetching a guessed round", async () => {
  mockSeasonLeaderboard.mockResolvedValue({ season: 2026, participant_count: 0, entries: [] });

  render(<NrlTipsLeaderboard season={2026} seasonOnly />);

  expect(await screen.findByText(/No graded tips yet this season/)).toBeInTheDocument();
  expect(mockSeasonLeaderboard).toHaveBeenCalledWith(2026);
  expect(mockLeaderboard).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Weekly" })).toBeNull();
});

// ---- The model as a ranked row (C2-2) ---------------------------------------

it("ranks the model among the tippers with a model badge and an em-dash margin", async () => {
  mockLeaderboard.mockResolvedValue({
    season: 2026, round: 27, participant_count: 1,
    entries: [
      { handle: "SoloTipper", points: 1, round_margin: 3, is_model: false },
      { handle: MODEL, points: 0, round_margin: null, is_model: true },
    ] as never,
  });

  render(<NrlTipsLeaderboard season={2026} round={27} />);

  const rows = (await screen.findAllByRole("row")).slice(1);
  expect(rows).toHaveLength(2);
  expect(within(rows[1]).getByText("Model")).toBeInTheDocument();
  expect(within(rows[1]).getByText("2", { selector: "td:first-child" })).toBeInTheDocument();
  expect(within(rows[1]).getByText("—")).toBeInTheDocument();
  expect(within(rows[1]).queryByRole("button")).toBeNull();
});

it("tells the viewer where they stand against the model this round", async () => {
  mockLeaderboard.mockResolvedValue({
    season: 2026, round: 27, participant_count: 1,
    entries: [
      { handle: "SoloTipper", points: 6, round_margin: 3, is_model: false },
      { handle: MODEL, points: 5, round_margin: null, is_model: true },
    ] as never,
  });

  render(<NrlTipsLeaderboard season={2026} round={27} />);
  await screen.findByText("SoloTipper");
  act(() => reportViewerHandle("SoloTipper"));

  expect(await screen.findByText("You're beating the model by 1 pt this round")).toBeInTheDocument();
});

it("tells the viewer by how much the model leads on the season board", async () => {
  mockSeasonLeaderboard.mockResolvedValue({
    season: 2026, participant_count: 1,
    entries: [
      { handle: MODEL, points: 140, total_margin: null, rounds_played: 27, is_model: true },
      { handle: "SeasonTipper", points: 99, total_margin: 40, rounds_played: 20, is_model: false },
    ] as never,
  });

  render(<NrlTipsLeaderboard season={2026} seasonOnly viewerHandle="SeasonTipper" />);
  expect(await screen.findByText("The model leads you by 41 pts this season")).toBeInTheDocument();
});

it("keeps an honest empty state for a round nobody tipped -- even with the model row present", async () => {
  mockLeaderboard.mockResolvedValue({
    season: 2026, round: 27, participant_count: 0,
    entries: [{ handle: MODEL, points: 2, round_margin: null, is_model: true }] as never,
  });

  render(<NrlTipsLeaderboard season={2026} round={27} />);
  expect(await screen.findByText(/No one has tipped this round yet/)).toBeInTheDocument();
  expect(screen.getByText(/The model has 2 pts so far\./)).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
