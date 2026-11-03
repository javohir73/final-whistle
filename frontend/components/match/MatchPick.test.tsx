/** MatchPick: the match page's pick sits under the model's call and, for club
 *  leagues, IS the scored game (/tips/submit), not a browser-only W/D/L. */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { getMatchSummary } from "@/lib/api";
import { getMyLeagueTips, submitLeagueTip } from "@/lib/leagueTips";
import { ApiError, getOrCreateDeviceId, pingDailyActivity } from "@/lib/session";
import { trackEvent } from "@/lib/analytics";
import type { LeagueTipsMineMatch, LeagueTipsMineResponse, MatchSummary } from "@/lib/types";
import { MatchLiveProvider } from "./MatchLiveProvider";
import { MatchPick, pickLockLine } from "./MatchPick";

jest.mock("@/lib/api");
jest.mock("@/lib/leagueTips");
jest.mock("@/lib/analytics");
jest.mock("@/lib/session", () => {
  const actual = jest.requireActual("@/lib/session");
  return { ...actual, getOrCreateDeviceId: jest.fn(), pingDailyActivity: jest.fn() };
});

const mockMine = getMyLeagueTips as jest.MockedFunction<typeof getMyLeagueTips>;
const mockSubmit = submitLeagueTip as jest.MockedFunction<typeof submitLeagueTip>;
const mockDevice = getOrCreateDeviceId as jest.MockedFunction<typeof getOrCreateDeviceId>;
const mockPing = pingDailyActivity as jest.MockedFunction<typeof pingDailyActivity>;
const mockTrack = trackEvent as jest.MockedFunction<typeof trackEvent>;
const mockSummary = getMatchSummary as jest.MockedFunction<typeof getMatchSummary>;

const at = (mins: number) => new Date(Date.now() + mins * 60_000).toISOString();

function summary(over: Partial<MatchSummary> = {}): MatchSummary {
  return {
    match_id: 501, stage: "group", group: null, kickoff_utc: at(24 * 60),
    venue: null, venue_city: null, venue_country: null, is_neutral: false,
    status: "scheduled", score_home: null, score_away: null, minute: null,
    period: null, injury_time: null, penalty_home: null, penalty_away: null,
    goal_events: [], teams: { home: "Arsenal", away: "Chelsea" },
    predicted_winner: "Arsenal", probabilities: { home_win: 0.5, draw: 0.27, away_win: 0.23 },
    predicted_score: { home: 1, away: 0, probability: 0.11 }, confidence: "Medium",
    ...over,
  };
}

function row(over: Partial<LeagueTipsMineMatch> = {}): LeagueTipsMineMatch {
  return {
    id: 501, home: "Arsenal", away: "Chelsea", kickoff_utc: at(24 * 60), status: "scheduled",
    score_home: null, score_away: null, model: null, your_prediction: null,
    ...over,
  };
}

function mine(r: LeagueTipsMineMatch = row()): LeagueTipsMineResponse {
  return { league: "epl", matchweek: 11, handle: "SwiftStriker42", matches: [r], disclaimer: "" };
}

const MODEL = { predicted_home: 1, predicted_away: 0, model_version: "poisson-elo-club-v0.6" };

function renderPick(s: MatchSummary | null = summary(), competition: "epl" | "wc26" | "ucl" = "epl") {
  const kickoff = s?.kickoff_utc ?? at(24 * 60);
  // The page's live poll keeps reporting the same state unless a test says otherwise.
  if (s) mockSummary.mockResolvedValue(s);
  return render(
    <MatchLiveProvider matchId={501} competition={competition} kickoffUtc={kickoff} initialSummary={s}>
      <MatchPick competition={competition} matchId={501} home="Arsenal" away="Chelsea" kickoffUtc={kickoff} />
    </MatchLiveProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mockDevice.mockReturnValue("8b1c5d2e-1f3a-4c5b-9d6e-7f8a9b0c1d2e");
  mockPing.mockResolvedValue(undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.resetAllMocks();
});

it("offers the scored scoreline stepper before kickoff and locks the pick in", async () => {
  mockMine.mockResolvedValue(mine());
  mockSubmit.mockResolvedValue({
    ok: true, handle: "SwiftStriker42", model: MODEL,
    prediction: { match_id: 501, predicted_home: 2, predicted_away: 1, updated_at: "2026-11-03T10:00:00+00:00" },
  });
  renderPick();

  const pick = screen.getByRole("region", { name: "Your pick" });
  expect(within(pick).getByText(/^Locks at kickoff · /)).toBeInTheDocument();
  const homeGoals = await screen.findByRole("group", { name: "Arsenal goals" });
  // The model's frozen scoreline stays hidden until the pick is in.
  expect(screen.queryByText(/Model 1–0/)).not.toBeInTheDocument();
  expect(screen.getByText(/Your first pick is final/)).toBeInTheDocument();

  fireEvent.click(within(homeGoals).getByRole("button", { name: "More Arsenal goals" }));
  fireEvent.click(within(homeGoals).getByRole("button", { name: "More Arsenal goals" }));
  fireEvent.click(screen.getByRole("button", { name: "More Chelsea goals" }));
  expect(mockSubmit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Lock in 2–1" }));

  expect(await screen.findByText("You 2–1 · Model 1–0")).toBeInTheDocument();
  expect(mockSubmit).toHaveBeenCalledWith("epl", {
    device_id: "8b1c5d2e-1f3a-4c5b-9d6e-7f8a9b0c1d2e", match_id: 501, predicted_home: 2, predicted_away: 1,
  });
  expect(mockTrack).toHaveBeenCalledWith("pick_submit", { competition: "epl", match_id: 501, source: "match_page" });
  // A pick is engagement (gates the install prompt) and pings retention.
  expect(JSON.parse(localStorage.getItem("finalwhistle:engagement:v1") ?? "{}").picks).toBe(1);
  expect(mockPing).toHaveBeenCalled();
  // /play's cache sees it at once.
  expect(JSON.parse(localStorage.getItem("finalwhistle:league-tips:v1:epl:11") ?? "{}")[501]).toEqual({
    predicted_home: 2, predicted_away: 1,
  });
  expect(screen.queryByRole("group", { name: "Arsenal goals" })).not.toBeInTheDocument();
});

it("caps the stepper at 0–9 goals", async () => {
  mockMine.mockResolvedValue(mine());
  renderPick();
  const homeGoals = await screen.findByRole("group", { name: "Arsenal goals" });
  expect(within(homeGoals).getByRole("button", { name: "Fewer Arsenal goals" })).toBeDisabled();
  for (let i = 0; i < 12; i += 1) {
    fireEvent.click(within(homeGoals).getByRole("button", { name: "More Arsenal goals" }));
  }
  expect(within(homeGoals).getByText("9")).toBeInTheDocument();
  expect(within(homeGoals).getByRole("button", { name: "More Arsenal goals" })).toBeDisabled();
});

it("shows an existing pick against the model instead of the stepper", async () => {
  mockMine.mockResolvedValue(mine(row({
    model: MODEL,
    your_prediction: { predicted_home: 2, predicted_away: 1, points: null, exact: null, graded_at: null, updated_at: null },
  })));
  renderPick();
  expect(await screen.findByText("You 2–1 · Model 1–0")).toBeInTheDocument();
  expect(screen.getByText(/Locked in/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Lock in/ })).not.toBeInTheDocument();
});

it("is locked after kickoff with no pick, and reveals the model's frozen scoreline", async () => {
  const kicked = summary({ kickoff_utc: at(-20), status: "in_play", minute: 20, period: "first_half", score_home: 0, score_away: 0 });
  mockMine.mockResolvedValue(mine(row({ kickoff_utc: kicked.kickoff_utc, status: "in_play", model: MODEL })));
  renderPick(kicked);
  expect(screen.getByText("Locked at kickoff")).toBeInTheDocument();
  expect(await screen.findByText("Picks closed at kickoff")).toBeInTheDocument();
  expect(screen.getByText(/Model 1–0/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Lock in/ })).not.toBeInTheDocument();
});

it("grades the pick after full time with points and links to the game", async () => {
  const done = summary({ kickoff_utc: at(-3 * 24 * 60), status: "finished", score_home: 3, score_away: 1 });
  mockMine.mockResolvedValue(mine(row({
    kickoff_utc: done.kickoff_utc, status: "finished", score_home: 3, score_away: 1, model: MODEL,
    your_prediction: {
      predicted_home: 2, predicted_away: 1, points: 2, exact: false,
      graded_at: "2026-11-01T18:00:00+00:00", updated_at: null,
    },
  })));
  renderPick(done);
  expect(await screen.findByText("You +2 pts · right result")).toBeInTheDocument();
  expect(screen.getByText("You 2–1 · Model 1–0 · Final 3–1")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Your picks →" })).toHaveAttribute("href", "/play?competition=epl");
  expect(screen.getByRole("link", { name: "Leaderboard →" })).toHaveAttribute("href", "/leaderboard?competition=epl");
});

it("keeps the shell and offers a retry when the tips API fails", async () => {
  mockMine.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(mine());
  renderPick();
  expect(await screen.findByText("Picks unavailable right now")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Your pick" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("group", { name: "Arsenal goals" })).toBeInTheDocument();
});

it("shows the pick that already exists when the server says it is final", async () => {
  mockMine
    .mockResolvedValueOnce(mine())
    .mockResolvedValue(mine(row({
      model: MODEL,
      your_prediction: { predicted_home: 1, predicted_away: 1, points: null, exact: null, graded_at: null, updated_at: null },
    })));
  mockSubmit.mockRejectedValue(
    new ApiError(409, "prediction_finalized", "Your prediction is final because the model score has been revealed."),
  );
  renderPick();
  fireEvent.click(await screen.findByRole("button", { name: "Lock in 0–0" }));

  expect(await screen.findByText("You 1–1 · Model 1–0")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(/final because the model score has been revealed/);
  expect(mockTrack).not.toHaveBeenCalled();
});

it("locks the stepper at kickoff on an open tab, without a reload", async () => {
  jest.useFakeTimers();
  const soon = summary({ kickoff_utc: at(0.25) }); // kicks off in 15 s
  mockMine.mockResolvedValue(mine(row({ kickoff_utc: soon.kickoff_utc, model: MODEL })));
  renderPick(soon);
  await act(async () => {});
  expect(screen.getByRole("button", { name: "Lock in 0–0" })).toBeInTheDocument();

  await act(async () => { jest.advanceTimersByTime(30_000); });
  await waitFor(() => expect(screen.queryByRole("button", { name: /Lock in/ })).not.toBeInTheDocument());
  expect(screen.getByText("Picks closed at kickoff")).toBeInTheDocument();
  expect(screen.getByText("Locked at kickoff")).toBeInTheDocument();
});

it("keeps the World Cup's W/D/L pick as its knockout adapter", () => {
  renderPick(summary(), "wc26");
  const group = screen.getByRole("group", { name: /Your prediction for Arsenal vs Chelsea/ });
  expect(within(group).getByRole("button", { name: "Draw" })).toBeInTheDocument();
  expect(mockMine).not.toHaveBeenCalled();
});

it("says plainly when a competition's score picks are not open", () => {
  renderPick(summary(), "ucl");
  expect(screen.getByText(/Score picks for UEFA Champions League aren.t open yet/)).toBeInTheDocument();
  expect(mockMine).not.toHaveBeenCalled();
});

describe("pickLockLine", () => {
  const now = new Date("2026-11-08T10:00:00Z");
  it("names the kickoff time and zone while open", () => {
    expect(pickLockLine("scheduled", "2026-11-08T15:00:00Z", now, "UTC")).toBe("Locks at kickoff · 3:00 PM UTC");
    expect(pickLockLine("scheduled", "2026-11-12T15:00:00Z", now, "UTC")).toBe("Locks at kickoff · Thu 12 Nov, 3:00 PM UTC");
  });
  it("says locked after kickoff, and handles deliberate stops", () => {
    expect(pickLockLine("scheduled", "2026-11-08T09:00:00Z", now, "UTC")).toBe("Locked at kickoff");
    expect(pickLockLine("in_play", "2026-11-08T09:00:00Z", now, "UTC")).toBe("Locked at kickoff");
    expect(pickLockLine("postponed", "2026-11-01T09:00:00Z", now, "UTC")).toBe("Postponed · picks stay open");
    expect(pickLockLine("cancelled", "2026-11-08T15:00:00Z", now, "UTC")).toBe("Cancelled · picks closed");
  });
});
