import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LeagueTipsPicker } from "./LeagueTipsPicker";
import { getMyLeagueTips, submitLeagueTip } from "@/lib/leagueTips";
import { ApiError, getOrCreateDeviceId, pingDailyActivity } from "@/lib/session";
import { trackEvent } from "@/lib/analytics";
import { loadEngagement } from "@/lib/engagement";
import { resetViewerHandleForTests, useViewerHandle } from "@/components/play/viewerHandle";
import type { LeagueTipsMineMatch, LeagueTipsMineResponse } from "@/lib/types";

jest.mock("@/lib/leagueTips");
jest.mock("@/lib/analytics");
jest.mock("@/lib/session", () => {
  const actual = jest.requireActual("@/lib/session");
  return { ...actual, getOrCreateDeviceId: jest.fn(), pingDailyActivity: jest.fn() };
});

const mockMine = getMyLeagueTips as jest.MockedFunction<typeof getMyLeagueTips>;
const mockSubmit = submitLeagueTip as jest.MockedFunction<typeof submitLeagueTip>;
const mockDeviceId = getOrCreateDeviceId as jest.MockedFunction<typeof getOrCreateDeviceId>;
const mockPing = pingDailyActivity as jest.MockedFunction<typeof pingDailyActivity>;
const mockTrack = trackEvent as jest.MockedFunction<typeof trackEvent>;

// resetAllMocks (below) wipes any implementation set inside the jest.mock
// factory too, so the device id / ping stubs are (re)installed per test here
// rather than baked in above. localStorage also isn't reset between tests by
// default -- a confirmed submit's cache write must not leak a stale
// prediction into a later test's initial render (mirrors PlayRound.test.tsx).
beforeEach(() => {
  localStorage.clear();
  mockDeviceId.mockReturnValue("device-1");
  mockPing.mockResolvedValue(undefined);
});
afterEach(() => jest.resetAllMocks());

const future = (mins: number) => new Date(Date.now() + mins * 60_000).toISOString();
const past = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

function mine(overrides: Partial<LeagueTipsMineResponse> = {}): LeagueTipsMineResponse {
  return {
    league: "epl",
    matchweek: 3,
    handle: "SwiftStriker42",
    matches: [
      {
        id: 501, home: "Arsenal", away: "Chelsea", kickoff_utc: future(60), status: "scheduled",
        score_home: null, score_away: null,
        model: null,
        your_prediction: null,
      },
    ],
    disclaimer: "For analytics and entertainment only. Not betting advice.",
    ...overrides,
  };
}

it("submits the composed score only when the reveal button is pressed", async () => {
  mockMine.mockResolvedValue(mine());
  mockSubmit.mockResolvedValue({
    ok: true, handle: "SwiftStriker42",
    model: { predicted_home: 2, predicted_away: 1, model_version: "poisson-elo-club-v0.1" },
    prediction: { match_id: 501, predicted_home: 1, predicted_away: 0, updated_at: "2026-08-22T10:00:00+00:00" },
  });

  render(<LeagueTipsPicker league="epl" />);
  const group = await screen.findByRole("group", { name: /Arsenal vs Chelsea/i });
  fireEvent.click(within(group).getByRole("button", { name: "Increase Arsenal goals" }));

  expect(mockSubmit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Lock prediction and reveal model/i }));

  await waitFor(() =>
    expect(mockSubmit).toHaveBeenCalledWith("epl", {
      device_id: "device-1", match_id: 501, predicted_home: 1, predicted_away: 0,
    }),
  );
  expect(mockPing).toHaveBeenCalled();
});

it("reveals the model scoreline only after a confirmed submit", async () => {
  mockMine.mockResolvedValue(mine());
  mockSubmit.mockResolvedValue({
    ok: true,
    handle: "SwiftStriker42",
    model: { predicted_home: 2, predicted_away: 1, model_version: "poisson-elo-club-v0.1" },
    prediction: {
      match_id: 501,
      predicted_home: 1,
      predicted_away: 0,
      updated_at: "2026-08-22T10:00:00+00:00",
    },
  });

  render(<LeagueTipsPicker league="epl" />);
  const group = await screen.findByRole("group", { name: /Arsenal vs Chelsea/i });
  expect(screen.queryByText("ML model")).not.toBeInTheDocument();

  fireEvent.click(within(group).getByRole("button", { name: "Increase Arsenal goals" }));

  fireEvent.click(screen.getByRole("button", { name: /Lock prediction and reveal model/i }));

  expect(await screen.findByText("ML model")).toBeInTheDocument();
  expect(screen.getByText("2–1")).toBeInTheDocument();
  expect(screen.getByText(/prediction locked/i)).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: /Arsenal vs Chelsea/i })).not.toBeInTheDocument();
});

it("withholds a model score leaked by an older backend for an unlocked unpicked match", async () => {
  mockMine.mockResolvedValue(mine({
    matches: [{
      id: 501,
      home: "Arsenal",
      away: "Chelsea",
      kickoff_utc: future(60),
      status: "scheduled",
      score_home: null,
      score_away: null,
      model: {
        predicted_home: 2,
        predicted_away: 1,
        model_version: "poisson-elo-club-v0.1",
      },
      your_prediction: null,
    }],
  }));

  render(<LeagueTipsPicker league="epl" />);
  await screen.findByRole("group", { name: /Arsenal vs Chelsea/i });

  expect(screen.queryByText("ML model")).not.toBeInTheDocument();
  expect(screen.queryByText("2–1")).not.toBeInTheDocument();
});

it("shows both a home and away goals input for an unlocked fixture", async () => {
  mockMine.mockResolvedValue(mine());
  render(<LeagueTipsPicker league="epl" />);
  await screen.findByRole("group", { name: /Arsenal vs Chelsea/i });
  expect(screen.getAllByRole("spinbutton")).toHaveLength(2);
});

it("renders a previously submitted prediction as final with no editable controls", async () => {
  mockMine.mockResolvedValue(
    mine({
      matches: [
        {
          id: 501, home: "Arsenal", away: "Chelsea", kickoff_utc: future(60), status: "scheduled",
          score_home: null, score_away: null, model: null,
          your_prediction: {
            predicted_home: 0, predicted_away: 15, points: null, exact: null,
            graded_at: null, updated_at: "2026-08-01T00:00:00Z",
          },
        },
      ],
    }),
  );

  render(<LeagueTipsPicker league="epl" />);
  expect(await screen.findByText(/You predicted/)).toBeInTheDocument();
  expect(screen.getByText(/prediction locked/i)).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: /Arsenal vs Chelsea/i })).not.toBeInTheDocument();
});

it("renders a kickoff-locked row frozen, with no picker controls", async () => {
  mockMine.mockResolvedValue(
    mine({
      matches: [
        {
          id: 502, home: "Arsenal", away: "Chelsea", kickoff_utc: past(10), status: "scheduled",
          score_home: null, score_away: null, model: null,
          your_prediction: {
            predicted_home: 2, predicted_away: 1, points: null, exact: null,
            graded_at: null, updated_at: "2026-08-01T00:00:00Z",
          },
        },
      ],
    }),
  );

  render(<LeagueTipsPicker league="epl" />);
  expect(await screen.findByText("Locked")).toBeInTheDocument();
  expect(screen.getByText(/You predicted/)).toBeInTheDocument();
  expect(screen.getByText(/awaiting full time/)).toBeInTheDocument();
  expect(screen.queryByRole("group")).not.toBeInTheDocument();
});

it("reveals the model scoreline once the fixture is locked", async () => {
  mockMine.mockResolvedValue(
    mine({
      matches: [
        {
          id: 502, home: "Arsenal", away: "Chelsea", kickoff_utc: past(10), status: "scheduled",
          score_home: null, score_away: null,
          model: { predicted_home: 2, predicted_away: 1, model_version: "poisson-elo-club-v0.1" },
          your_prediction: null,
        },
      ],
    }),
  );

  render(<LeagueTipsPicker league="epl" />);
  expect(await screen.findByText("ML model")).toBeInTheDocument();
  expect(screen.getByText("2–1")).toBeInTheDocument();
});

it("shows the no-prediction-submitted state for a locked match the device never predicted", async () => {
  mockMine.mockResolvedValue(
    mine({
      matches: [
        {
          id: 503, home: "Arsenal", away: "Chelsea", kickoff_utc: past(5), status: "scheduled",
          score_home: null, score_away: null, model: null, your_prediction: null,
        },
      ],
    }),
  );

  render(<LeagueTipsPicker league="epl" />);
  expect(await screen.findByText("No prediction submitted")).toBeInTheDocument();
});

it("shows the graded verdict once a locked prediction has been scored", async () => {
  mockMine.mockResolvedValue(
    mine({
      matches: [
        {
          id: 504, home: "Arsenal", away: "Chelsea", kickoff_utc: past(200), status: "finished",
          score_home: 2, score_away: 1, model: null,
          your_prediction: {
            predicted_home: 2, predicted_away: 1, points: 5, exact: true,
            graded_at: "2026-08-01T12:00:00Z", updated_at: "2026-08-01T00:00:00Z",
          },
        },
      ],
    }),
  );

  render(<LeagueTipsPicker league="epl" />);
  expect(await screen.findByText(/exact score!/)).toBeInTheDocument();
  expect(screen.getByText(/Final 2–1/)).toBeInTheDocument();
});

it("navigates to the next matchweek and re-fetches with the new number", async () => {
  mockMine.mockResolvedValueOnce(mine({ matchweek: 3 }));
  mockMine.mockResolvedValueOnce(
    mine({
      matchweek: 4,
      matches: [
        {
          id: 601, home: "Liverpool", away: "Everton", kickoff_utc: future(120), status: "scheduled",
          score_home: null, score_away: null, model: null, your_prediction: null,
        },
      ],
    }),
  );

  render(<LeagueTipsPicker league="epl" />);
  await screen.findByText("Matchweek 3");

  fireEvent.click(screen.getByRole("button", { name: /Matchweek 4/ }));
  await waitFor(() => expect(mockMine).toHaveBeenLastCalledWith("epl", "device-1", 4));
  expect(await screen.findByText("Matchweek 4")).toBeInTheDocument();
  expect(await screen.findByRole("group", { name: /Liverpool vs Everton/i })).toBeInTheDocument();
});

it("shows a friendly message and keeps the current matchweek when nav runs off the end", async () => {
  mockMine.mockResolvedValueOnce(mine({ matchweek: 3 }));
  mockMine.mockRejectedValueOnce(new ApiError(404, "matchweek_not_found", "No matches for matchweek 4"));

  render(<LeagueTipsPicker league="epl" />);
  await screen.findByText("Matchweek 3");

  fireEvent.click(screen.getByRole("button", { name: /Matchweek 4/ }));
  expect(await screen.findByText(/No epl matches loaded for that matchweek yet\./)).toBeInTheDocument();
  expect(screen.getByText("Matchweek 3")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Matchweek 4/ })).not.toBeInTheDocument();
});

it("hides the Prev control on matchweek 1", async () => {
  mockMine.mockResolvedValue(mine({ matchweek: 1 }));
  render(<LeagueTipsPicker league="epl" />);
  await screen.findByText("Matchweek 1");
  expect(screen.queryByRole("button", { name: /Matchweek 0/ })).not.toBeInTheDocument();
});

it("shows a season-not-started state when the league has no data loaded yet", async () => {
  mockMine.mockRejectedValue(new ApiError(404, "league_inactive", "League 'epl' has no data loaded yet"));
  render(<LeagueTipsPicker league="epl" />);
  expect(await screen.findByText(/hasn't kicked off yet/)).toBeInTheDocument();
});

it("shows the same season-not-started state for any other league passed in, not just epl", async () => {
  mockMine.mockRejectedValue(new ApiError(404, "league_inactive", "League 'laliga' has no data loaded yet"));
  render(<LeagueTipsPicker league="laliga" />);
  expect(await screen.findByText(/hasn't kicked off yet/)).toBeInTheDocument();
  expect(mockMine).toHaveBeenCalledWith("laliga", "device-1", undefined);
});

it("treats league_not_found for an unregistered league the same as league_inactive", async () => {
  mockMine.mockRejectedValue(new ApiError(404, "league_not_found", "Unknown league 'bundesliga'"));
  render(<LeagueTipsPicker league="bundesliga" />);
  expect(await screen.findByText(/hasn't kicked off yet/)).toBeInTheDocument();
});

it("surfaces a rejected submit honestly and reverts the optimistic prediction", async () => {
  mockMine.mockResolvedValue(mine());
  mockSubmit.mockRejectedValue(new ApiError(422, "match_locked", "Match 501 has kicked off and is locked."));

  render(<LeagueTipsPicker league="epl" />);
  const group = await screen.findByRole("group", { name: /Arsenal vs Chelsea/i });
  fireEvent.click(within(group).getByRole("button", { name: "Increase Arsenal goals" }));
  fireEvent.click(screen.getByRole("button", { name: /Lock prediction and reveal model/i }));

  expect(await screen.findByText("Match 501 has kicked off and is locked.")).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole("spinbutton", { name: "Arsenal goals" })).toHaveValue(0),
  );
  expect(screen.queryByText("ML model")).not.toBeInTheDocument();
});

it.each(["cancelled", "suspended"] as const)("locks a %s fixture and labels it", async (status) => {
  mockMine.mockResolvedValue(
    mine({
      matches: [{
        id: 505, home: "Arsenal", away: "Chelsea", kickoff_utc: future(60), status,
        score_home: null, score_away: null, model: null, your_prediction: null,
      }],
    }),
  );

  render(<LeagueTipsPicker league="epl" />);
  expect(await screen.findByText(status === "cancelled" ? "Cancelled" : "Suspended")).toBeInTheDocument();
  expect(screen.queryByRole("group")).not.toBeInTheDocument();
  expect(screen.getByText("No prediction submitted")).toBeInTheDocument();
});

it("keeps a postponed fixture editable after its original kickoff", async () => {
  mockMine.mockResolvedValue(
    mine({
      matches: [{
        id: 506, home: "Arsenal", away: "Chelsea", kickoff_utc: past(60), status: "postponed",
        score_home: null, score_away: null, model: null, your_prediction: null,
      }],
    }),
  );

  render(<LeagueTipsPicker league="epl" />);
  expect(await screen.findByText("Postponed")).toBeInTheDocument();
  expect(screen.getByRole("group", { name: /Arsenal vs Chelsea/i })).toBeInTheDocument();
});

// ---- Safety net: a matchweek with nothing left to pick (C2-1) ----------------

function fixture(id: number, overrides: Partial<LeagueTipsMineMatch> = {}): LeagueTipsMineMatch {
  return {
    id, home: `Home ${id}`, away: `Away ${id}`, kickoff_utc: future(60), status: "scheduled",
    score_home: null, score_away: null, model: null, your_prediction: null,
    ...overrides,
  };
}
const fullTime = (id: number) =>
  fixture(id, { kickoff_utc: past(3 * 24 * 60), status: "finished", score_home: 2, score_away: 1 });

it("auto-advances once from an initial matchweek with nothing left to pick, and says so", async () => {
  const onMatchweekChange = jest.fn();
  mockMine.mockResolvedValueOnce(mine({ matchweek: 9, matches: [fullTime(901), fullTime(902)] }));
  mockMine.mockResolvedValueOnce(mine({ matchweek: 10, matches: [fixture(1001)] }));

  render(<LeagueTipsPicker league="laliga" onMatchweekChange={onMatchweekChange} />);

  expect(await screen.findByText("Matchweek 9 is done — showing Matchweek 10")).toBeInTheDocument();
  expect(mockMine).toHaveBeenNthCalledWith(1, "laliga", "device-1", undefined);
  expect(mockMine).toHaveBeenNthCalledWith(2, "laliga", "device-1", 10);
  expect(screen.getByRole("group", { name: /Home 1001 vs Away 1001/ })).toBeInTheDocument();
  // The leaderboard above only ever hears about the week actually shown.
  expect(onMatchweekChange).toHaveBeenCalledTimes(1);
  expect(onMatchweekChange).toHaveBeenCalledWith(10);
});

it("treats a ghost fixture still marked scheduled after kickoff as nothing to pick", async () => {
  mockMine.mockResolvedValueOnce(
    mine({ matchweek: 2, matches: [fullTime(201), fixture(202, { kickoff_utc: past(60 * 24 * 70) })] }),
  );
  mockMine.mockResolvedValueOnce(mine({ matchweek: 3, matches: [fixture(301)] }));

  render(<LeagueTipsPicker league="laliga" />);

  expect(await screen.findByText("Matchweek 2 is locked — showing Matchweek 3")).toBeInTheDocument();
  expect(mockMine).toHaveBeenLastCalledWith("laliga", "device-1", 3);
});

it("never loops: advances at most once even when the next matchweek is locked too", async () => {
  mockMine.mockResolvedValueOnce(mine({ matchweek: 9, matches: [fullTime(901)] }));
  mockMine.mockResolvedValueOnce(
    mine({ matchweek: 10, matches: [fixture(1001, { kickoff_utc: past(30) })] }),
  );
  mockMine.mockResolvedValue(mine({ matchweek: 11, matches: [fixture(1101)] }));

  render(<LeagueTipsPicker league="epl" />);

  expect(await screen.findByText("Matchweek 9 is done — showing Matchweek 10")).toBeInTheDocument();
  await act(async () => {});
  expect(mockMine).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Matchweek 10")).toBeInTheDocument();
});

it("stays on a matchweek that still has an open fixture", async () => {
  mockMine.mockResolvedValue(mine({ matchweek: 9, matches: [fullTime(901), fixture(902)] }));

  render(<LeagueTipsPicker league="epl" />);

  expect(await screen.findByText("Matchweek 9")).toBeInTheDocument();
  await act(async () => {});
  expect(mockMine).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/is done — showing/)).not.toBeInTheDocument();
});

it("does not auto-advance after an explicit prev navigation to a finished matchweek", async () => {
  mockMine.mockResolvedValueOnce(mine({ matchweek: 10, matches: [fixture(1001)] }));
  mockMine.mockResolvedValueOnce(mine({ matchweek: 9, matches: [fullTime(901), fullTime(902)] }));
  mockMine.mockResolvedValue(mine({ matchweek: 10, matches: [fixture(1001)] }));

  render(<LeagueTipsPicker league="epl" />);
  await screen.findByText("Matchweek 10");

  fireEvent.click(screen.getByRole("button", { name: /Matchweek 9/ }));
  expect(await screen.findByText("Matchweek 9")).toBeInTheDocument();
  await act(async () => {});
  expect(mockMine).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(/is done — showing/)).not.toBeInTheDocument();
});

it("clears the auto-advance notice once the player navigates themselves", async () => {
  mockMine.mockResolvedValueOnce(mine({ matchweek: 9, matches: [fullTime(901)] }));
  mockMine.mockResolvedValueOnce(mine({ matchweek: 10, matches: [fixture(1001)] }));
  mockMine.mockResolvedValueOnce(mine({ matchweek: 9, matches: [fullTime(901)] }));

  render(<LeagueTipsPicker league="epl" />);
  await screen.findByText("Matchweek 9 is done — showing Matchweek 10");

  fireEvent.click(screen.getByRole("button", { name: /Matchweek 9/ }));
  expect(await screen.findByText("Matchweek 9")).toBeInTheDocument();
  expect(screen.queryByText(/is done — showing/)).not.toBeInTheDocument();
});

it("stays on the loaded matchweek with the existing message when the advance hits the end", async () => {
  const onMatchweekChange = jest.fn();
  mockMine.mockResolvedValueOnce(mine({ matchweek: 38, matches: [fullTime(3801)] }));
  mockMine.mockRejectedValueOnce(new ApiError(404, "matchweek_not_found", "No matches for matchweek 39"));

  render(<LeagueTipsPicker league="epl" onMatchweekChange={onMatchweekChange} />);

  expect(await screen.findByText(/No epl matches loaded for that matchweek yet\./)).toBeInTheDocument();
  expect(screen.getByText("Matchweek 38")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Matchweek 39/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/showing Matchweek/)).not.toBeInTheDocument();
  expect(onMatchweekChange).toHaveBeenCalledWith(38);
});

it("does not ask for a prediction on a matchweek with nothing left to pick", async () => {
  mockMine.mockResolvedValueOnce(mine({ matchweek: 10, matches: [fixture(1001)] }));
  mockMine.mockResolvedValueOnce(mine({ matchweek: 9, matches: [fullTime(901)] }));

  render(<LeagueTipsPicker league="epl" />);
  expect(await screen.findByText(/Make your prediction to reveal/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /Matchweek 9/ }));
  await screen.findByText("Matchweek 9");
  expect(screen.queryByText(/Make your prediction to reveal/)).not.toBeInTheDocument();
});

// ---- Engagement + analytics on a confirmed submit (C2-3) --------------------

it("counts a confirmed submit as engagement and tracks tips_submit", async () => {
  mockMine.mockResolvedValue(mine());
  mockSubmit.mockResolvedValue({
    ok: true, handle: "SwiftStriker42",
    model: { predicted_home: 2, predicted_away: 1, model_version: "poisson-elo-club-v0.1" },
    prediction: { match_id: 501, predicted_home: 0, predicted_away: 0, updated_at: "2026-08-22T10:00:00+00:00" },
  });

  render(<LeagueTipsPicker league="epl" />);
  await screen.findByRole("group", { name: /Arsenal vs Chelsea/i });
  expect(loadEngagement().picks).toBe(0);

  fireEvent.click(screen.getByRole("button", { name: /Lock prediction and reveal model/i }));

  await waitFor(() =>
    expect(mockTrack).toHaveBeenCalledWith("tips_submit", { competition: "epl", matchweek: 3, match_id: 501 }),
  );
  expect(loadEngagement().picks).toBe(1);
});

it("neither counts nor tracks a rejected submit", async () => {
  mockMine.mockResolvedValue(mine());
  mockSubmit.mockRejectedValue(new ApiError(422, "match_locked", "Match 501 has kicked off and is locked."));

  render(<LeagueTipsPicker league="epl" />);
  await screen.findByRole("group", { name: /Arsenal vs Chelsea/i });
  fireEvent.click(screen.getByRole("button", { name: /Lock prediction and reveal model/i }));

  expect(await screen.findByText("Match 501 has kicked off and is locked.")).toBeInTheDocument();
  expect(mockTrack).not.toHaveBeenCalledWith("tips_submit", expect.anything());
  expect(loadEngagement().picks).toBe(0);
});

it("reports the device's handle so leaderboards on the page can find the viewer's row", async () => {
  function Probe() {
    return <p data-testid="viewer">{useViewerHandle() ?? "none"}</p>;
  }
  mockMine.mockResolvedValue(mine({ handle: "SwiftStriker42" }));

  render(
    <>
      <LeagueTipsPicker league="epl" />
      <Probe />
    </>,
  );

  await waitFor(() => expect(screen.getByTestId("viewer")).toHaveTextContent("SwiftStriker42"));
  act(() => resetViewerHandleForTests());
});
