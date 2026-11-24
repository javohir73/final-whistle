/** The direction-G match page (MatchPageContent), rendered as the scoped
 *  /football/{comp}/match/{id} route renders it. Asserts the layout (top bar,
 *  hero with the pick, the cards below) and the reveal rule end to end: an
 *  OPEN fixture never carries the model's numbers -- not in the page, not in
 *  the metadata -- until this viewer's pick is locked; a finished match shows
 *  the call graded by the game's own scoring. */
import { render, screen, waitFor, within } from "@testing-library/react";
import { generateMatchMetadata, renderMatchDetailPage } from "./MatchPageContent";
import {
  getGroupsServer,
  getMatchLineups,
  getMatchServer,
  getMatchSummary,
  getMatchSummaryServer,
  getUpcomingMatchesServer,
} from "@/lib/api";
import { getMyLeagueTips } from "@/lib/leagueTips";
import { getOrCreateDeviceId } from "@/lib/session";
import { resetRevealStore } from "@/lib/useModelReveal";
import type { Group, LeagueTipsMineResponse, MatchSummary, Prediction } from "@/lib/types";
import type { CompetitionId } from "@/lib/sports";

jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  getMatchServer: jest.fn(),
  getMatchSummaryServer: jest.fn(),
  getMatchSummary: jest.fn(),
  getGroupsServer: jest.fn(),
  getUpcomingMatchesServer: jest.fn(),
  getMatchLineups: jest.fn(),
}));
jest.mock("@/lib/leagueTips");
jest.mock("@/lib/session", () => {
  const actual = jest.requireActual("@/lib/session");
  return { ...actual, getOrCreateDeviceId: jest.fn(), pingDailyActivity: jest.fn() };
});

const mockGet = getMatchServer as jest.MockedFunction<typeof getMatchServer>;
const mockSummaryServer = getMatchSummaryServer as jest.MockedFunction<typeof getMatchSummaryServer>;
const mockSummary = getMatchSummary as jest.MockedFunction<typeof getMatchSummary>;
const mockGroups = getGroupsServer as jest.MockedFunction<typeof getGroupsServer>;
const mockUpcoming = getUpcomingMatchesServer as jest.MockedFunction<typeof getUpcomingMatchesServer>;
const mockLineups = getMatchLineups as jest.MockedFunction<typeof getMatchLineups>;
const mockMine = getMyLeagueTips as jest.MockedFunction<typeof getMyLeagueTips>;
const mockDevice = getOrCreateDeviceId as jest.MockedFunction<typeof getOrCreateDeviceId>;

const FUTURE = new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString();
const PAST = new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString();

const prediction: Prediction = {
  match_id: 205,
  model_version: "poisson-elo-v0.6",
  generated_at: "2026-11-06T00:00:00Z",
  teams: { home: "Newcastle", away: "Arsenal" },
  home_team_id: 355,
  away_team_id: 339,
  group: "Premier League",
  group_id: 1,
  stage: "group",
  is_neutral: false,
  kickoff_utc: FUTURE,
  venue: "St James' Park",
  venue_city: "Newcastle",
  venue_country: null,
  probabilities: { home_win: 0.1385, draw: 0.2592, away_win: 0.6023 },
  predicted_score: { home: 0, away: 2, probability: 0.1231 },
  confidence: "Medium",
  reasons: ["Arsenal has a much higher Elo rating (1868 vs 1566).", "Arsenal won 4 of the last 5 meetings."],
  top_features: [],
  head_to_head: { matches: 5, home_wins: 1, draws: 0, away_wins: 4 },
  odds_comparison: { available: false },
  disclaimer: "For analytics and entertainment only. Not betting advice.",
  goal_markets: {
    home: { to_score: 0.5423, p2: 0.18, p3: 0.04, p4: 0.01 },
    away: { to_score: 0.885, p2: 0.63, p3: 0.36, p4: 0.17 },
    total: { over_1_5: 0.79, over_2_5: 0.5642, over_3_5: 0.34 },
    btts: 0.4852,
  },
  matchweek: 11,
};

function summary(over: Partial<MatchSummary> = {}): MatchSummary {
  return {
    match_id: 205, stage: "group", group: "Premier League", kickoff_utc: FUTURE,
    venue: "St James' Park", venue_city: "Newcastle", venue_country: null, is_neutral: false,
    status: "scheduled", score_home: null, score_away: null, minute: null,
    period: null, injury_time: null, penalty_home: null, penalty_away: null,
    goal_events: [], teams: { home: "Newcastle", away: "Arsenal" },
    predicted_winner: "Arsenal", probabilities: prediction.probabilities,
    predicted_score: prediction.predicted_score, confidence: "Medium", matchweek: 11,
    ...over,
  };
}

const groups: Group[] = [{
  id: 1, name: "Premier League",
  standings: [
    { team_id: 339, team: "Arsenal", projected_points: 27, projected_goals_for: 15, projected_goal_diff: 10, qualification_prob: null, played: 10, won: 9, drawn: 0, lost: 1, goals_against: 5 },
    { team_id: 343, team: "Brighton", projected_points: 22, projected_goals_for: 26, projected_goal_diff: 19, qualification_prob: null, played: 10, won: 7, drawn: 1, lost: 2, goals_against: 7 },
    { team_id: 355, team: "Newcastle", projected_points: 12, projected_goals_for: 12, projected_goal_diff: -3, qualification_prob: null, played: 10, won: 3, drawn: 3, lost: 4, goals_against: 15 },
  ],
}];

const week = [
  summary({ match_id: 204, teams: { home: "Leeds", away: "Everton" }, kickoff_utc: new Date(Date.parse(FUTURE) - 3600_000).toISOString() }),
  summary(),
  summary({ match_id: 206, teams: { home: "Chelsea", away: "Fulham" }, kickoff_utc: new Date(Date.parse(FUTURE) + 3600_000).toISOString() }),
  summary({ match_id: 190, matchweek: 10, teams: { home: "A", away: "B" } }),
];

function mine(picked = false): LeagueTipsMineResponse {
  return {
    league: "epl", matchweek: 11, handle: null, disclaimer: "",
    matches: week.filter((m) => m.matchweek === 11).map((m) => ({
      id: m.match_id, home: m.teams.home, away: m.teams.away, kickoff_utc: m.kickoff_utc, status: "scheduled",
      score_home: null, score_away: null,
      model: picked && m.match_id === 205 ? { predicted_home: 0, predicted_away: 2, model_version: "x" } : null,
      your_prediction: picked && m.match_id === 205
        ? { predicted_home: 2, predicted_away: 1, points: null, exact: null, graded_at: null, updated_at: null }
        : null,
    })),
  };
}

const marketsPayload = {
  match_id: 205,
  model_version: "poisson-elo-v0.6",
  markets: {
    one_x_two: { home_win: 0.1385, draw: 0.2592, away_win: 0.6023 },
    totals: [{ line: 2.5, over: 0.5642, under: 0.4358 }],
    btts: { yes: 0.4852, no: 0.5148 },
    correct_score: [{ home: 0, away: 2, prob: 0.1231 }],
    asian_handicap: [{ line: -0.5, home: 0.14, push: 0, away: 0.86 }],
  },
  disclaimer: "Not betting advice.",
};

const fetchMock = jest.fn();
const marketsCalls = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes("/markets"));

async function renderPage(competition: CompetitionId = "epl", id = "205") {
  return render(await renderMatchDetailPage(Promise.resolve({ id }), competition));
}

beforeEach(() => {
  resetRevealStore();
  window.localStorage.setItem("pp:timezone", JSON.stringify({ tz: "UTC", confirmed: true }));
  mockGet.mockResolvedValue(prediction);
  mockSummaryServer.mockResolvedValue(summary());
  mockSummary.mockResolvedValue(summary());
  mockGroups.mockResolvedValue(groups);
  mockUpcoming.mockResolvedValue(week);
  mockLineups.mockResolvedValue({ available: false, message: null, home: null, away: null, fetched_at: null });
  mockDevice.mockReturnValue("8b1c5d2e-1f3a-4c5b-9d6e-7f8a9b0c1d2e");
  mockMine.mockResolvedValue(mine());
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => (String(url).includes("/markets") ? marketsPayload : prediction),
  }));
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
});

const MODEL_NUMBERS = /14%|26%|60%|0–2|56%|49%|Medium confidence|Elo rating/;

describe("an open fixture, not picked", () => {
  it("lays out the top bar, the hero with an empty pick, and the hidden state -- no model numbers", async () => {
    const { container } = await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Newcastle v Arsenal" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Matchweek 11" })).toHaveAttribute("href", "/football/epl?mw=11");
    expect(screen.getByText("Match 2 of 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Previous match: Leeds v Everton" })).toHaveAttribute("href", "/football/epl/match/204");
    expect(screen.getByRole("link", { name: "Next match: Chelsea v Fulham" })).toHaveAttribute("href", "/football/epl/match/206");
    expect(screen.getByText(/Premier League · .* · St James' Park/)).toBeInTheDocument();
    // Real table rows: "1st · 27 points" under the club.
    expect(screen.getByText("1st · 27 points")).toBeInTheDocument();
    expect(screen.getByText("3rd · 12 points")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Newcastle 3rd/ })).toHaveAttribute("href", "/football/epl/team/355");

    expect(await screen.findByRole("button", { name: "Use + and − to set a score" })).toBeDisabled();
    const locked = screen.getByRole("region", { name: "Unlocked when you lock your pick" });
    expect(within(locked).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "The model’s score", "Win, draw and loss chances", "Why the model thinks so", "Goal chances",
    ]);
    const stand = screen.getByRole("region", { name: "Where they stand" });
    expect(within(stand).getByText("The table after 10 matchweeks.")).toBeInTheDocument();
    expect(within(stand).getByRole("link", { name: "Full table" })).toHaveAttribute("href", "/football/epl/standings");

    await waitFor(() => expect(mockMine).toHaveBeenCalled());
    expect(container.textContent).not.toMatch(MODEL_NUMBERS);
    expect(container.querySelector("#forecast")).toBeNull();
    // Hidden means not even fetched, and the markets card is not rendered.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Full match markets")).not.toBeInTheDocument();
  });

  it("server-renders no model numbers into the markup", async () => {
    const tree = await renderMatchDetailPage(Promise.resolve({ id: "205" }), "epl");
    const { renderToString } = jest.requireActual("react-dom/server.node") as typeof import("react-dom/server");
    const g = globalThis as unknown as Record<string, unknown>;
    if (!g.TextEncoder) g.TextEncoder = jest.requireActual("node:util").TextEncoder;
    const html = renderToString(tree);
    expect(html).not.toMatch(/14%|26%|60%|0–2|0\.6023|1868|Medium/);
    expect(html).toContain("Unlocked when you lock your pick");
  });
});

describe("an open fixture with a locked pick", () => {
  it("reveals the call, the reasons and the goal chances (read after the lock)", async () => {
    mockMine.mockResolvedValue(mine(true));
    const { container } = await renderPage();
    await screen.findByText("Medium confidence. Shown because your pick is locked.");
    const call = screen.getByRole("region", { name: "The model’s call" });
    expect(call).toHaveTextContent("You 2–1");
    expect(call).toHaveTextContent("0–2");
    expect(within(call).getByRole("img", { name: "Newcastle 14%, draw 26%, Arsenal 60%" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/backend-api/api/matches/205?competition=epl", expect.anything());
    expect(container.querySelector("#forecast")).toBe(call);
    expect(container.querySelector("#why")).toHaveTextContent("Arsenal won 4 of the last 5 meetings.");
    expect(container.querySelector("#goals")).toHaveTextContent("Over 2.5 goals56%");
    expect(screen.queryByRole("region", { name: "Unlocked when you lock your pick" })).not.toBeInTheDocument();
    // Section order: hero (with #pick) → call → why/goals → where they stand.
    const order = ["#pick", "#forecast", "#why", "#goals"].map((s) => container.querySelector(s)!);
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // Locked pick: the free markets card appears, fetched for this fixture.
    expect(await screen.findByText("Full match markets")).toBeInTheDocument();
    expect(marketsCalls().map(([url]) => url)).toEqual(["/backend-api/api/matches/205/markets"]);
    expect(container.textContent).not.toMatch(/premium|members/i);
    // The pick in the hero is final.
    expect(await within(container.querySelector("#pick") as HTMLElement).findByText(/Locked\./)).toBeInTheDocument();
  });
});

describe("a finished match", () => {
  const ft = summary({ status: "finished", kickoff_utc: PAST, score_home: 1, score_away: 2, score_home_90: 1, score_away_90: 2 });
  beforeEach(() => {
    mockGet.mockResolvedValue({ ...prediction, kickoff_utc: PAST });
    mockSummaryServer.mockResolvedValue(ft);
    mockSummary.mockResolvedValue(ft);
  });

  it("shows the full-time score and the model's call graded by the game's scoring", async () => {
    const { container } = await renderPage();
    expect(screen.getByText("Full time")).toBeInTheDocument();
    const call = screen.getByRole("region", { name: "The model’s call" });
    expect(within(call).getByText("Made before kick-off. Medium confidence.")).toBeInTheDocument();
    // Model 0–2 vs result 1–2: right result.
    expect(within(call).getByText("Right result · 2 points")).toBeInTheDocument();
    expect(container.querySelector("#pick")).toBeNull();
    // The call itself is public: sent by the server, never fetched here.
    expect(fetchMock.mock.calls.filter(([url]) => !String(url).includes("/markets"))).toEqual([]);
  });

  it("adds the viewer's own graded pick when there is one", async () => {
    mockMine.mockResolvedValue({
      ...mine(),
      matches: [{
        id: 205, home: "Newcastle", away: "Arsenal", kickoff_utc: PAST, status: "finished", score_home: 1, score_away: 2,
        model: { predicted_home: 0, predicted_away: 2, model_version: "x" },
        your_prediction: { predicted_home: 1, predicted_away: 2, points: 5, exact: true, graded_at: "2026-11-10T00:00:00Z", updated_at: null },
      }],
    });
    await renderPage();
    const call = screen.getByRole("region", { name: "The model’s call" });
    expect(await within(call).findByText("Exact score · 5 points")).toBeInTheDocument();
    expect(call).toHaveTextContent("Your pick 1–2");
  });
});

describe("other competitions", () => {
  it("shows the Champions League call on an open fixture (no pick game)", async () => {
    mockUpcoming.mockResolvedValue([]);
    mockGroups.mockResolvedValue(null);
    await renderPage("ucl");
    expect(screen.getByText(/Score picks for the UEFA Champions League aren.t open yet/)).toBeInTheDocument();
    const call = screen.getByRole("region", { name: "The model’s call" });
    expect(within(call).getByText("Medium confidence.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Where they stand" })).not.toBeInTheDocument();
    // No pick game: the call is open, so the free markets card shows too.
    expect(await screen.findByText("Full match markets")).toBeInTheDocument();
  });

  it("renders the pending view when the prediction is not generated yet", async () => {
    mockGet.mockResolvedValue(null);
    mockSummaryServer.mockResolvedValue(summary({ probabilities: null, predicted_score: null }));
    await renderPage();
    expect(screen.getByRole("heading", { name: "The model’s call is on the way" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Use + and − to set a score" })).toBeInTheDocument();
  });

  it("calls notFound() for a match that does not exist", async () => {
    mockGet.mockResolvedValue(null);
    mockSummaryServer.mockResolvedValue(null);
    await expect(renderMatchDetailPage(Promise.resolve({ id: "999" }), "epl")).rejects.toThrow();
  });
});

describe("metadata", () => {
  it("never names the model's numbers for an open fixture", async () => {
    const meta = await generateMatchMetadata(Promise.resolve({ id: "205" }), "epl");
    expect(meta.alternates?.canonical).toBe("/football/epl/match/205");
    expect(meta.title).toBe("Newcastle v Arsenal — make your pick | FinalWhistle");
    const text = `${meta.title} ${meta.description} ${meta.openGraph?.description} ${meta.openGraph?.title}`;
    expect(text).not.toMatch(/\d+%|0–2|Most likely/);
  });

  it("states the call once the match is finished", async () => {
    mockSummaryServer.mockResolvedValue(summary({ status: "finished", kickoff_utc: PAST, score_home: 1, score_away: 2 }));
    const meta = await generateMatchMetadata(Promise.resolve({ id: "205" }), "epl");
    expect(meta.description).toContain("Newcastle 14%, draw 26%, Arsenal 60%");
    expect(meta.description).toContain("Most likely score 0–2");
  });
});
