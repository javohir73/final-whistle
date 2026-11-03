/** The football match centre (MatchPageContent), rendered as the scoped
 *  /football/{comp}/match/{id} route renders it. Asserts the rebuilt order --
 *  hero → your pick → why → forecast & market → goals & scorers → lineups →
 *  footer -- and the honesty rules: the predicted score never sits in the
 *  real-score slot, the W/D/L split is drawn once, the footer timestamp is this
 *  prediction's own, and nothing is called KO / LIVE / FULL TIME that the feed
 *  has not confirmed. */
import { render, screen, within } from "@testing-library/react";
import { generateMatchMetadata, renderMatchDetailPage } from "./MatchPageContent";
import {
  getMatchServer,
  getMatchSummary,
  getMatchSummaryServer,
  getMatchGoalscorersServer,
  getModelRecordServer,
  getProbHistoryServer,
} from "@/lib/api";
import { getMyLeagueTips } from "@/lib/leagueTips";
import { getOrCreateDeviceId } from "@/lib/session";
import type { MatchSummary, Prediction } from "@/lib/types";
import type { CompetitionId } from "@/lib/sports";

jest.mock("@/lib/api");
jest.mock("@/lib/leagueTips");
jest.mock("@/lib/session", () => {
  const actual = jest.requireActual("@/lib/session");
  return { ...actual, getOrCreateDeviceId: jest.fn(), pingDailyActivity: jest.fn() };
});
// PremiumMarkets reads useAuth() unconditionally; billing stays off here, so
// it renders nothing -- this mock only stands in for a real <AuthProvider>.
jest.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: null, loading: false, openSignIn: jest.fn() }),
}));

const mockGet = getMatchServer as jest.MockedFunction<typeof getMatchServer>;
const mockSummaryServer = getMatchSummaryServer as jest.MockedFunction<typeof getMatchSummaryServer>;
const mockSummary = getMatchSummary as jest.MockedFunction<typeof getMatchSummary>;
const mockGoalscorers = getMatchGoalscorersServer as jest.MockedFunction<typeof getMatchGoalscorersServer>;
const mockHistory = getProbHistoryServer as jest.MockedFunction<typeof getProbHistoryServer>;
const mockRecord = getModelRecordServer as jest.MockedFunction<typeof getModelRecordServer>;
const mockMine = getMyLeagueTips as jest.MockedFunction<typeof getMyLeagueTips>;
const mockDevice = getOrCreateDeviceId as jest.MockedFunction<typeof getOrCreateDeviceId>;

// Recharts (the feature chart) needs a non-zero layout size in jsdom.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 500 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 300 });
});

const FUTURE_KICKOFF = new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString();

const prediction: Prediction = {
  match_id: 1,
  model_version: "poisson-elo-v0.6",
  generated_at: "2026-06-06T00:00:00Z",
  teams: { home: "Brazil", away: "Serbia" },
  home_team_id: 10,
  away_team_id: 20,
  group: "Group C",
  group_id: 3,
  stage: "group",
  is_neutral: true,
  kickoff_utc: FUTURE_KICKOFF,
  venue: null,
  venue_city: null,
  venue_country: null,
  probabilities: { home_win: 0.62, draw: 0.24, away_win: 0.14 },
  predicted_score: { home: 2, away: 0, probability: 0.17 },
  confidence: "High",
  reasons: ["Brazil has a higher Elo rating.", "Serbia have won their last three away games."],
  top_features: [{ name: "elo_gap", weight: 0.66 }],
  head_to_head: { matches: 1, home_wins: 1, draws: 0, away_wins: 0 },
  odds_comparison: { available: false },
  disclaimer: "For analytics and entertainment only. Not betting advice.",
  goal_markets: null,
};

function summary(over: Partial<MatchSummary> = {}): MatchSummary {
  return {
    match_id: 1, stage: "group", group: "Group C", kickoff_utc: FUTURE_KICKOFF,
    venue: null, venue_city: null, venue_country: null, is_neutral: true,
    status: "scheduled", score_home: null, score_away: null, minute: null,
    period: null, injury_time: null, penalty_home: null, penalty_away: null,
    goal_events: [], teams: { home: "Brazil", away: "Serbia" },
    predicted_winner: "Brazil", probabilities: prediction.probabilities,
    predicted_score: prediction.predicted_score, confidence: "High",
    ...over,
  };
}

const twoWeeksOfHistory = {
  match_id: 1,
  disclaimer: "",
  points: [
    { date: "2026-06-01", p_home: 0.5, p_draw: 0.3, p_away: 0.2 },
    { date: "2026-06-03", p_home: 0.58, p_draw: 0.26, p_away: 0.16 },
    { date: "2026-06-05", p_home: 0.62, p_draw: 0.24, p_away: 0.14 },
  ],
};

async function renderPage(competition: CompetitionId = "wc26", id = "1") {
  return render(await renderMatchDetailPage(Promise.resolve({ id }), competition));
}

beforeEach(() => {
  // The footer and status lines render in the reader's zone; pin it.
  window.localStorage.setItem("pp:timezone", JSON.stringify({ tz: "UTC", confirmed: true }));
  mockGet.mockResolvedValue(prediction);
  mockSummaryServer.mockResolvedValue(summary());
  mockSummary.mockResolvedValue(summary());
  mockHistory.mockResolvedValue({ match_id: 1, points: [], disclaimer: "" });
  mockGoalscorers.mockResolvedValue(null);
  mockDevice.mockReturnValue("8b1c5d2e-1f3a-4c5b-9d6e-7f8a9b0c1d2e");
  mockMine.mockResolvedValue({
    league: "epl", matchweek: 11, handle: null, disclaimer: "",
    matches: [{
      id: 1, home: "Brazil", away: "Serbia", kickoff_utc: FUTURE_KICKOFF, status: "scheduled",
      score_home: null, score_away: null, model: null, your_prediction: null,
    }],
  });
});
afterEach(() => {
  jest.resetAllMocks();
  window.localStorage.clear();
});

describe("section order", () => {
  it("runs hero → your pick → why → forecast & market → goals & scorers → lineups → footer", async () => {
    mockHistory.mockResolvedValue(twoWeeksOfHistory);
    mockGet.mockResolvedValue({
      ...prediction,
      odds_comparison: { available: true, market: { home_win: 0.58, draw: 0.25, away_win: 0.17 } },
      goal_markets: {
        home: { to_score: 0.86, p2: 0.6, p3: 0.45, p4: 0.38 },
        away: { to_score: 0.39, p2: 0.12, p3: 0.03, p4: 0.01 },
        total: { over_1_5: 0.78, over_2_5: 0.55, over_3_5: 0.3 },
        btts: 0.34,
      },
    });
    mockGoalscorers.mockResolvedValue({
      mode: "squad",
      home: [{ name: "A. Striker", position: "F", p_score: 0.31, p_score_2plus: 0.06, xg: 0.37 }],
      away: [{ name: "B. Forward", position: "F", p_score: 0.22, p_score_2plus: 0.03, xg: 0.25 }],
    });
    const { container } = await renderPage("wc26");

    const order = [
      screen.getByRole("region", { name: "Brazil vs Serbia" }),
      container.querySelector("#pick"),
      container.querySelector("#why"),
      container.querySelector("#forecast"),
      container.querySelector("#goals"),
      container.querySelector("#lineups"),
      container.querySelector("footer"),
    ];
    order.forEach((el) => expect(el).not.toBeNull());
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // The pick is the second block: directly under the model's call.
    expect(within(container.querySelector("#pick") as HTMLElement).getByRole("heading", { name: "Your pick" })).toBeInTheDocument();
    expect(within(container.querySelector("#goals") as HTMLElement).getByText("Goals")).toBeInTheDocument();
    expect(screen.getByText("Likely scorers")).toBeInTheDocument();
    // No Overview/Lineups tab split any more: lineups are a section.
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(within(container.querySelector("#lineups") as HTMLElement).getByRole("heading", { name: "Lineups" })).toBeInTheDocument();
  });
});

describe("the hero says each thing once", () => {
  it("keeps the predicted score out of the real-score slot and draws ONE labelled bar", async () => {
    await renderPage("wc26");
    const hero = screen.getByRole("region", { name: "Brazil vs Serbia" });

    expect(within(hero).getByText("vs")).toBeInTheDocument();
    expect(screen.queryByText(/MOST LIKELY SCORE/i)).not.toBeInTheDocument();
    expect(within(hero).getByText("Most likely 2–0 · 17%")).toBeInTheDocument();
    // One sentence, one bar for the whole page (no history, no market).
    expect(within(hero).getByText("Brazil favoured")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /win \d+%/ })).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Brazil win 62%, draw 24%, Serbia win 14%" })).toBeInTheDocument();
    // Confidence is the tier chip, not a ring repeating the 62%.
    expect(within(hero).getByText("High confidence")).toBeInTheDocument();
    expect(screen.queryByText("HIGH")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /High confidence/ })).not.toBeInTheDocument();
  });

  it("drops the forecast section entirely when there is no trajectory and no market", async () => {
    const { container } = await renderPage("wc26");
    expect(container.querySelector("#forecast")).toBeNull();
    expect(screen.queryByText(/Forecast movement appears/i)).not.toBeInTheDocument();
  });

  it("puts the market in one row under a real trajectory, never two more bars", async () => {
    mockHistory.mockResolvedValue(twoWeeksOfHistory);
    mockGet.mockResolvedValue({
      ...prediction,
      odds_comparison: { available: true, market: { home_win: 0.58, draw: 0.25, away_win: 0.17 } },
    });
    const { container } = await renderPage("wc26");
    const forecast = container.querySelector("#forecast") as HTMLElement;
    expect(within(forecast).getByRole("img", { name: /Model forecast for Brazil/ })).toBeInTheDocument();
    expect(forecast).toHaveTextContent("Brazil: model 62% · market 58% (model +4 pts)");
    expect(within(forecast).queryByRole("img", { name: /win \d+%/ })).not.toBeInTheDocument();
  });
});

describe("why", () => {
  it("puts the reasons under one heading with neutral bullets", async () => {
    const { container } = await renderPage("wc26");
    const why = container.querySelector("#why") as HTMLElement;
    expect(within(why).getByRole("heading", { name: "Why this prediction" })).toBeInTheDocument();
    expect(within(why).getByText(/higher Elo rating/)).toBeInTheDocument();
    // "Serbia have won..." argues against the pick: no supporting "+".
    expect(within(why).queryByText("+")).not.toBeInTheDocument();
  });
});

describe("the pick", () => {
  it("is the scored scoreline game on a league match page", async () => {
    await renderPage("epl");
    const pick = screen.getByRole("region", { name: "Your pick" });
    expect(await within(pick).findByRole("button", { name: "Lock in 0–0" })).toBeInTheDocument();
    expect(within(pick).getByText(/^Locks at kickoff · /)).toBeInTheDocument();
    expect(mockMine).toHaveBeenCalledWith("epl", "8b1c5d2e-1f3a-4c5b-9d6e-7f8a9b0c1d2e", undefined);
    // No browser-only W/D/L on a league page.
    expect(within(pick).queryByRole("button", { name: "Draw" })).not.toBeInTheDocument();
  });

  it("keeps the W/D/L pick for the World Cup", async () => {
    await renderPage("wc26");
    const pick = screen.getByRole("region", { name: "Your pick" });
    expect(within(pick).getByRole("button", { name: "Draw" })).toBeInTheDocument();
    expect(mockMine).not.toHaveBeenCalled();
  });

  it("never hides the pick shell when the summary is unavailable", async () => {
    mockSummaryServer.mockResolvedValue(null);
    mockSummary.mockRejectedValue(new Error("cold start"));
    await renderPage("wc26");
    const pick = screen.getByRole("region", { name: "Your pick" });
    expect(await within(pick).findByText("Picks unavailable right now")).toBeInTheDocument();
    expect(within(pick).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("honest time and labels", () => {
  it("stamps the footer with THIS prediction's generated_at in the reader's zone, never the global record", async () => {
    const { container } = await renderPage("wc26");
    const footer = container.querySelector("footer") as HTMLElement;
    expect(footer).toHaveTextContent("Prediction generated 6 Jun, 12:00 AM UTC · model poisson-elo-v0.6 ·");
    expect(footer).toHaveTextContent(/Not betting advice/);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("ends a pre-kickoff forecast at 'Latest', never 'KO'", async () => {
    mockHistory.mockResolvedValue(twoWeeksOfHistory);
    await renderPage("wc26");
    expect(screen.getByText("Latest · 5 Jun")).toBeInTheDocument();
    expect(screen.queryByText("KO")).not.toBeInTheDocument();
  });

  it("marks an estimated live minute as such", async () => {
    const live = summary({
      kickoff_utc: new Date(Date.now() - 70 * 60_000).toISOString(),
      status: "in_play", score_home: 1, score_away: 0, minute: 63, period: "second_half",
    });
    mockSummaryServer.mockResolvedValue(live);
    mockSummary.mockResolvedValue(live);
    await renderPage("wc26");
    expect(screen.getByText(/LIVE · 63' est\./)).toBeInTheDocument();
  });

  it("says Result pending -- not FULL TIME, no verdict -- when the feed is stranded in play", async () => {
    const stranded = summary({
      kickoff_utc: new Date(Date.now() - 8 * 60 * 60_000).toISOString(),
      status: "in_play", score_home: 2, score_away: 0, minute: 90, period: "second_half",
    });
    mockSummaryServer.mockResolvedValue(stranded);
    mockSummary.mockResolvedValue(stranded);
    await renderPage("wc26");
    expect(screen.getByText("RESULT PENDING · Venue TBC")).toBeInTheDocument();
    expect(screen.getByText("2–0")).toBeInTheDocument(); // the last known score
    expect(screen.queryByText(/FULL TIME/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Exact score predicted|Result predicted right|Model missed/)).not.toBeInTheDocument();
  });
});

describe("data loading", () => {
  it("starts the prediction and summary together, then the secondary reads together", async () => {
    let releaseGoalscorers!: (v: null) => void;
    mockGoalscorers.mockReturnValue(new Promise((resolve) => { releaseGoalscorers = resolve; }));
    const pending = renderMatchDetailPage(Promise.resolve({ id: "1" }), "wc26");

    await new Promise((r) => setTimeout(r, 0));
    expect(mockGet).toHaveBeenCalledWith("1", "wc26");
    expect(mockSummaryServer).toHaveBeenCalledWith("1", "wc26");
    // History was requested while goalscorers was still in flight.
    expect(mockGoalscorers).toHaveBeenCalledWith("1");
    expect(mockHistory).toHaveBeenCalledWith("1");

    releaseGoalscorers(null);
    render(await pending);
    expect(screen.getByRole("region", { name: "Brazil vs Serbia" })).toBeInTheDocument();
  });

  it("calls notFound() for a match that does not exist", async () => {
    mockGet.mockResolvedValue(null);
    mockSummaryServer.mockResolvedValue(null);
    await expect(renderMatchDetailPage(Promise.resolve({ id: "999" }), "wc26")).rejects.toThrow();
    expect(mockGoalscorers).not.toHaveBeenCalled();
  });

  it("renders the pending view (same hero, same pick shell) when the prediction is not generated yet", async () => {
    mockGet.mockResolvedValue(null);
    mockSummaryServer.mockResolvedValue(summary({
      match_id: 76, stage: "R32", group: null, venue_city: "Philadelphia", venue_country: "USA",
      teams: { home: "Brazil", away: "Japan" }, probabilities: null, predicted_score: null,
    }));
    await renderPage("wc26", "76");

    expect(screen.getByRole("region", { name: "Brazil vs Japan" })).toBeInTheDocument();
    expect(screen.getByText(/prediction on the way/i)).toBeInTheDocument();
    expect(screen.getByText(/Venue TBC, Philadelphia, USA/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Your pick" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Lineups" })).toBeInTheDocument();
  });
});

describe("metadata", () => {
  it("canonicalises to the competition-scoped URL with a 100% description", async () => {
    const meta = await generateMatchMetadata(Promise.resolve({ id: "1" }), "epl");
    expect(meta.alternates?.canonical).toBe("/football/epl/match/1");
    expect(meta.description).toContain("Brazil 62%, draw 24%, Serbia 14%");
  });
});
