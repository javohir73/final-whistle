/** NRL home -- server component (SSR) output, by season state: the season-
 *  complete page (Grand Final, the model's season, Origin, final ladder), the
 *  in-season round on the centred spine (tips + the reveal rule), and the
 *  pre-season Round 1. Kickoffs are relative to now. */
import { act, render, screen, within } from "@testing-library/react";
import { resetMyNrlRoundCache } from "@/components/nrl/useMyNrlRound";
import NrlHomePage from "./page";
import {
  getNrlLadderServer,
  getNrlMatchesServer,
  getNrlRecordServer,
  getOriginSeriesServer,
} from "@/lib/api";
import type { NrlMatch, NrlMatchesResponse, NrlPrediction, NrlRecord, OriginSeriesResponse } from "@/lib/types";
import { getMyNrlTips, nrlStartLabel } from "@/lib/nrlTips";

jest.mock("@/lib/api");
// The client tip cells read /tips/mine after mount; offline here, so they
// fall back to the "Tip" action. The server HTML is what is under test.
jest.mock("@/lib/nrlTips", () => ({
  ...jest.requireActual("@/lib/nrlTips"),
  getMyNrlTips: jest.fn(() => new Promise(() => {})),
}));

const mockMatches = getNrlMatchesServer as jest.MockedFunction<typeof getNrlMatchesServer>;
const mockLadder = getNrlLadderServer as jest.MockedFunction<typeof getNrlLadderServer>;
const mockOrigin = getOriginSeriesServer as jest.MockedFunction<typeof getOriginSeriesServer>;
const mockRecord = getNrlRecordServer as jest.MockedFunction<typeof getNrlRecordServer>;

const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

const pred = (p_home: number, p_away: number, margin: number): NrlPrediction => ({
  p_home,
  p_draw: Number((1 - p_home - p_away).toFixed(2)),
  p_away,
  expected_margin: margin,
  model_version: "nrl-v0.1",
  created_at: null,
  is_shadow: false,
});

const fixtures: NrlMatchesResponse = {
  season: 2026,
  disclaimer: "For analytics and entertainment only. Not betting advice.",
  rounds: [
    {
      round: 20,
      matches: [
        {
          id: 1, match_no: 1, kickoff_utc: daysFromNow(2), venue: "Suncorp",
          home: "Broncos", away: "Storm", home_team_id: 1, away_team_id: 2,
          score_home: null, score_away: null, status: "scheduled", prediction: pred(0.7, 0.27, 8.5),
        },
        {
          id: 2, match_no: 2, kickoff_utc: daysFromNow(3), venue: "Accor Stadium",
          home: "Panthers", away: "Eels", home_team_id: 3, away_team_id: 4,
          score_home: null, score_away: null, status: "scheduled", prediction: pred(0.55, 0.41, 3.0),
        },
      ],
    },
  ],
};

const origin: OriginSeriesResponse = {
  season: 2026,
  seasons: [2026],
  games: [],
  series: { blues_wins: 2, maroons_wins: 1, drawn_games: 0, winner: "NSW Blues", odds: null },
  disclaimer: "For analytics and entertainment only. Not betting advice.",
};


const ladderRows = Array.from({ length: 17 }, (_, i) => ({
  rank: i + 1, team_id: 100 + i, name: i === 1 ? "Roosters" : `Club ${i + 1}`,
  played: 24, wins: 20 - i, draws: 0, losses: 4 + i, points: 40 - 2 * i, diff: 100 - 10 * i,
}));

const record: NrlRecord = {
  evaluated_matches: 76, winner_accuracy: 0.6447, winner_accuracy_ci95: [0.5326, 0.743],
  avg_log_loss: 0.6589, avg_brier: 0.4532, best_streak: 6, last_updated: "2026-10-04T14:46:34Z",
  model_version: "nrl-elo-v0.1", disclaimer: "",
};

const fin = (id: number, home: string, away: string, sh: number, sa: number, d: number, p: NrlPrediction | null = null): NrlMatch => ({
  id, match_no: id, kickoff_utc: daysFromNow(d), venue: "Accor Stadium", home, away,
  home_team_id: id * 10, away_team_id: id * 10 + 1, score_home: sh, score_away: sa, status: "finished", prediction: p,
});

/** A finished season: a regular round, then finals 4/2/2/1 ending in the GF. */
const complete: NrlMatchesResponse = {
  season: 2026,
  disclaimer: "",
  rounds: [
    { round: 27, matches: Array.from({ length: 8 }, (_, i) => fin(100 + i, "A", "B", 10, 8, -60)) },
    { round: 28, matches: [1, 2, 3, 4].map((i) => fin(i, "C", "D", 10, 8, -55)) },
    { round: 29, matches: [5, 6].map((i) => fin(i, "C", "D", 10, 8, -50)) },
    { round: 30, matches: [7, 8].map((i) => fin(i, "C", "D", 10, 8, -45)) },
    { round: 31, matches: [fin(9, "Roosters", "Knights", 19, 18, -40, pred(0.64, 0.35, 4.6))] },
  ],
};

beforeEach(() => {
  mockLadder.mockResolvedValue(null);
  mockOrigin.mockResolvedValue(null);
  mockRecord.mockResolvedValue(null);
});
afterEach(() => {
  jest.clearAllMocks();
  resetMyNrlRoundCache();
});

describe("season complete", () => {
  beforeEach(() => {
    mockMatches.mockResolvedValue(complete);
    mockRecord.mockResolvedValue(record);
    mockLadder.mockResolvedValue({ season: 2026, rows: ladderRows, disclaimer: "" });
    mockOrigin.mockResolvedValue({ ...origin, games: [{ round: 1, match_no: 1, kickoff_utc: null, venue: null, neutral: false, home: "NSW Blues", away: "QLD Maroons", score_home: 22, score_away: 20, status: "finished", prediction: null }] });
  });

  it("heads the page with the premiers from the Grand Final and no promised date", async () => {
    render(await NrlHomePage());
    expect(screen.getByRole("heading", { level: 1, name: "Season complete" })).toBeInTheDocument();
    expect(screen.getByText("NRL · 2026 season")).toBeInTheDocument();
    expect(
      screen.getByText("The Roosters are premiers. Tips reopen when the 2027 draw is released."),
    ).toBeInTheDocument();
  });

  it("shows the Grand Final with the model's real call and no sample 'You' cell", async () => {
    render(await NrlHomePage());
    await act(async () => {});
    const gf = screen.getByRole("region", { name: /Full time Grand Final/ });
    expect(gf).toHaveTextContent("19");
    expect(gf).toHaveTextContent("18");
    expect(within(gf).getByText("Picked Roosters at 64%")).toBeInTheDocument();
    expect(within(gf).getByText("Called it")).toBeInTheDocument();
    // No tip from this device -> no "You" cell at all (never a sample).
    expect(within(gf).queryByText("You")).not.toBeInTheDocument();
    expect(within(gf).queryByText(/Sample/)).not.toBeInTheDocument();
  });

  it("shows the viewer's REAL Grand Final tip once /tips/mine returns it", async () => {
    (getMyNrlTips as jest.Mock).mockImplementationOnce(() =>
      Promise.resolve({
        season: 2026, round: 31, handle: "SwiftHalfback1", disclaimer: "",
        matches: [{ id: 9, home: "Roosters", away: "Knights", kickoff_utc: daysFromNow(-40), status: "finished",
          score_home: 19, score_away: 18, is_featured: true, model: null,
          your_tip: { pick: "home", margin: 2, points: 1, round_margin: 1, graded_at: null, updated_at: null } }],
      }),
    );
    render(await NrlHomePage());
    expect(await screen.findByText("Tipped Roosters")).toBeInTheDocument();
    expect(screen.getByText("Right result")).toBeInTheDocument();
  });

  it("states how the model went, with the API's own interval", async () => {
    render(await NrlHomePage());
    expect(screen.getByRole("heading", { name: "How the model went in 2026" })).toBeInTheDocument();
    expect(screen.getByText("64%")).toBeInTheDocument();
    expect(screen.getByText("76")).toBeInTheDocument();
    expect(screen.getByText("With 76 matches the true rate is likely between 53% and 74%.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the full record" })).toHaveAttribute("href", "/nrl/record");
  });

  it("links to the Origin series and shows the top eight of the final ladder", async () => {
    render(await NrlHomePage());
    expect(screen.getByRole("link", { name: /NSW Blues 2–1 QLD Maroons/ })).toHaveAttribute("href", "/nrl/origin");
    const ladder = screen.getByRole("region", { name: "Final ladder" });
    expect(within(ladder).getAllByRole("row")).toHaveLength(9); // header + 8
    expect(within(ladder).getByRole("link", { name: "All 17 clubs" })).toHaveAttribute("href", "/nrl/ladder");
    expect(within(ladder).getByText("The top eight played finals.")).toBeInTheDocument();
  });

  it("offers no reminder (there is no reminder endpoint)", async () => {
    render(await NrlHomePage());
    expect(screen.queryByRole("button", { name: /remind/i })).not.toBeInTheDocument();
  });
});

describe("in season", () => {
  it("opens on the current round on the centred spine with round arrows", async () => {
    mockMatches.mockResolvedValue({
      ...fixtures,
      rounds: [{ round: 19, matches: [fin(50, "Sharks", "Dragons", 30, 12, -5, pred(0.6, 0.38, 6))] }, ...fixtures.rounds],
    });
    render(await NrlHomePage());
    expect(screen.getByRole("heading", { level: 1, name: "Round 20" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Round 19" })).toHaveAttribute("href", "/nrl/round/19");
    expect(screen.getByRole("link", { name: /Broncos v Storm/ })).toHaveAttribute("href", "/nrl/match/2026/20/1");
    expect(screen.getByText("Suncorp")).toBeInTheDocument();
  });

  it("never server-renders the model's numbers for open matches (the reveal rule)", async () => {
    mockMatches.mockResolvedValue(fixtures);
    const { container } = render(await NrlHomePage());
    expect(container.textContent).not.toMatch(/70%|55%|Model/);
  });

  it("shows the tip action once the client knows there is no tip yet", async () => {
    (getMyNrlTips as jest.Mock).mockImplementationOnce(() => Promise.reject(new Error("offline")));
    mockMatches.mockResolvedValue(fixtures);
    render(await NrlHomePage());
    await act(async () => {});
    expect(await screen.findByRole("link", { name: "Tip Broncos v Storm" })).toHaveAttribute("href", "/nrl/tips");
  });

  it("between rounds: the last round's results with the model's verdicts, not 'season complete'", async () => {
    mockMatches.mockResolvedValue({
      ...fixtures,
      rounds: [{ round: 20, matches: [
        { ...fixtures.rounds[0].matches[0], kickoff_utc: daysFromNow(-2), status: "finished", score_home: 30, score_away: 10 },
        { ...fixtures.rounds[0].matches[1], kickoff_utc: daysFromNow(-1), status: "finished", score_home: 10, score_away: 30 },
      ] }],
    });
    render(await NrlHomePage());
    expect(screen.queryByText("Season complete")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Round 20" })).toBeInTheDocument();
    expect(screen.getByText("Called it")).toBeInTheDocument();
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.getByText("Missed")).toBeInTheDocument();
  });

  it("ignores a ghost fixture still marked scheduled long after kickoff", async () => {
    mockMatches.mockResolvedValue({
      ...fixtures,
      rounds: [
        { round: 19, matches: [{ ...fixtures.rounds[0].matches[0], id: 9, kickoff_utc: daysFromNow(-6) }] },
        ...fixtures.rounds,
      ],
    });
    render(await NrlHomePage());
    expect(screen.getByRole("heading", { level: 1, name: "Round 20" })).toBeInTheDocument();
  });
});

it("pre-season: Round 1 of the new draw, with its start date", async () => {
  const opener = daysFromNow(100);
  mockMatches.mockResolvedValue({
    season: 2027,
    disclaimer: "",
    rounds: [{ round: 1, matches: [{ ...fixtures.rounds[0].matches[0], kickoff_utc: opener }] }],
  });
  render(await NrlHomePage());
  expect(screen.getByRole("heading", { level: 1, name: "Season 2027" })).toBeInTheDocument();
  expect(screen.getByText(new RegExp(`Round 1 starts ${nrlStartLabel(opener)}`))).toBeInTheDocument();
});
