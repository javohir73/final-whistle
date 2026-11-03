/** NRL home page tests — server component (SSR) output. The FeatureHero leads
 *  with the round's first still-to-play fixture; the remaining fixtures fall
 *  down the shared timeline spine (the feature is excluded, so it never shows
 *  twice); the State of Origin teaser links out when the series endpoint has
 *  data. Once nothing is left to play, the page switches to its off-season
 *  state instead of dressing a played match up as "Tonight's feature".
 *  IntelPanel does its own client fetch, so it's stubbed here to keep these
 *  assertions on the restyled fixture surfaces. Kickoffs are relative to now
 *  so the in-season fixtures never age into the off-season branch. */
import { render, screen } from "@testing-library/react";
import NrlHomePage from "./page";
import {
  getNrlLadderServer,
  getNrlMatchesServer,
  getNrlRecordServer,
  getOriginSeriesServer,
} from "@/lib/api";
import type { NrlMatch, NrlMatchesResponse, NrlPrediction, NrlRecord, OriginSeriesResponse } from "@/lib/types";

jest.mock("@/lib/api");
// IntelPanel fetches market intel in a client effect; irrelevant here, but
// its presence is asserted (in season) / absence (off-season).
jest.mock("@/components/IntelPanel", () => ({
  IntelPanel: () => <div data-testid="intel-panel" />,
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

beforeEach(() => {
  mockLadder.mockResolvedValue(null); // mini ladder migrates in p3-s5; not under test here
  mockOrigin.mockResolvedValue(null);
  mockRecord.mockResolvedValue(null);
});
afterEach(() => jest.resetAllMocks());

it("leads with the FeatureHero for the round's first scheduled fixture", async () => {
  mockMatches.mockResolvedValue(fixtures);
  render(await NrlHomePage());

  // Featured = first scheduled match of the current round (Broncos v Storm).
  // getByText throwing on duplicates also proves the feature is NOT repeated in
  // the timeline below.
  expect(screen.getByText("Broncos")).toBeInTheDocument();
  // Its display-hero win % (max of 70/03/27).
  expect(screen.getByText("70")).toBeInTheDocument();
});

it("lists the round's remaining fixtures on the shared spine, feature excluded", async () => {
  mockMatches.mockResolvedValue(fixtures);
  render(await NrlHomePage());

  // The spine carries the round as its heading and the non-featured fixture.
  expect(screen.getByText("Round 20")).toBeInTheDocument();
  expect(screen.getAllByText(/Panthers/).length).toBeGreaterThan(0);
  // That fixture links to its (season, round, match_no) detail page.
  expect(screen.getAllByText(/Panthers/)[0].closest("a")).toHaveAttribute(
    "href",
    "/nrl/match/2026/20/2",
  );
});

it("does not link the FeatureHero CTAs to the football route when the round is TBC", async () => {
  // A fixture whose round is still null has no detail page (nrlMatchHref -> null).
  // The hero must degrade to non-interactive CTAs, never the football /match/<id>
  // route (NRL and football ids share the small-integer namespace).
  const tbc: NrlMatchesResponse = {
    ...fixtures,
    rounds: [
      {
        round: null,
        matches: [
          {
            id: 7, match_no: 1, kickoff_utc: daysFromNow(5), venue: "Suncorp",
            home: "Broncos", away: "Storm", home_team_id: 1, away_team_id: 2,
            score_home: null, score_away: null, status: "scheduled", prediction: pred(0.7, 0.27, 8.5),
          },
        ],
      },
    ],
  };
  mockMatches.mockResolvedValue(tbc);
  render(await NrlHomePage());

  // The hero still leads with the fixture, but its CTAs don't navigate anywhere.
  expect(screen.getByText("Broncos")).toBeInTheDocument();
  expect(screen.getByText("Make your pick")).toBeInTheDocument();
  expect(screen.getByText("Make your pick").closest("a")).toBeNull();
});

it("still renders the State of Origin teaser when the series endpoint has data", async () => {
  mockMatches.mockResolvedValue(fixtures);
  mockOrigin.mockResolvedValue(origin);
  render(await NrlHomePage());

  const originLink = screen.getByRole("link", { name: /State of Origin/i });
  expect(originLink).toHaveAttribute("href", "/nrl/origin");
});

// ---- Off-season (C2-4): nothing left to play -------------------------------

const played = (
  id: number,
  daysAgo: number,
  home: string,
  away: string,
  score: [number, number],
): NrlMatch => ({
  id, match_no: id, kickoff_utc: daysFromNow(-daysAgo), venue: "Accor Stadium",
  home, away, home_team_id: id * 2, away_team_id: id * 2 + 1,
  score_home: score[0], score_away: score[1], status: "finished", prediction: pred(0.55, 0.42, 2),
});

const completeSeason: NrlMatchesResponse = {
  season: 2026,
  disclaimer: "For analytics and entertainment only. Not betting advice.",
  rounds: [
    { round: 30, matches: [played(211, 38, "Dolphins", "Roosters", [20, 36]), played(212, 37, "Panthers", "Knights", [14, 22])] },
    { round: 31, matches: [played(213, 30, "Roosters", "Knights", [19, 18])] },
  ],
};

const record: NrlRecord = {
  evaluated_matches: 76, winner_accuracy: 0.6447, winner_accuracy_ci95: [0.53, 0.75],
  avg_log_loss: 0.6589, avg_brier: 0.4532, best_streak: 6, model_version: "nrl-elo-v0.1",
  last_updated: "2026-10-04T14:46:34Z", disclaimer: "For analytics and entertainment only.",
};

it("switches to the off-season state once no fixture is left to play", async () => {
  mockMatches.mockResolvedValue(completeSeason);
  mockRecord.mockResolvedValue(record);
  render(await NrlHomePage());

  expect(screen.getByRole("heading", { name: "2026 season complete" })).toBeInTheDocument();
  expect(screen.getByText(/Roosters are the 2026 premiers/)).toBeInTheDocument();
  expect(screen.getByText(/Back for Round 1, March 2027/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Play the Premier League meanwhile/ })).toHaveAttribute(
    "href",
    "/play?competition=epl",
  );
  expect(screen.getByRole("link", { name: /64% of winners/ })).toHaveAttribute("href", "/nrl/record");
});

it("never presents a played match as tonight's feature, and hides the movers panel", async () => {
  mockMatches.mockResolvedValue(completeSeason);
  render(await NrlHomePage());

  expect(screen.queryByText(/Tonight's feature/i)).not.toBeInTheDocument();
  expect(screen.queryByText("Make your pick")).not.toBeInTheDocument();
  expect(screen.queryByTestId("intel-panel")).not.toBeInTheDocument();
});

it("omits the premier when the last round isn't a single decided final", async () => {
  mockMatches.mockResolvedValue({
    ...completeSeason,
    rounds: [{ round: 27, matches: [played(201, 40, "Eels", "Storm", [10, 12]), played(202, 40, "Sharks", "Titans", [30, 6])] }],
  });
  render(await NrlHomePage());

  expect(screen.getByRole("heading", { name: "2026 season complete" })).toBeInTheDocument();
  expect(screen.queryByText(/premiers/)).not.toBeInTheDocument();
  // No record payload -> no record line, never a fabricated number.
  expect(screen.queryByRole("link", { name: /of winners/ })).not.toBeInTheDocument();
});

it("in season, ignores a ghost fixture still marked scheduled long after kickoff", async () => {
  mockMatches.mockResolvedValue({
    ...fixtures,
    rounds: [
      {
        round: 19,
        matches: [{
          id: 9, match_no: 9, kickoff_utc: daysFromNow(-6), venue: "Suncorp",
          home: "Dragons", away: "Rabbitohs", home_team_id: 9, away_team_id: 10,
          score_home: null, score_away: null, status: "scheduled", prediction: pred(0.5, 0.45, 1),
        }],
      },
      ...fixtures.rounds,
    ],
  });
  render(await NrlHomePage());

  // The feature is the real next fixture, from the round that is actually live.
  expect(screen.getByText("Broncos")).toBeInTheDocument();
  expect(screen.queryByText("Dragons")).not.toBeInTheDocument();
  expect(screen.getByTestId("intel-panel")).toBeInTheDocument();
});

it("between rounds, keeps the season view with an honest empty hero -- not 'season complete'", async () => {
  mockMatches.mockResolvedValue({
    ...fixtures,
    rounds: [{ round: 27, matches: [played(301, 3, "Eels", "Storm", [10, 12]), played(302, 3, "Sharks", "Titans", [30, 6])] }],
  });
  render(await NrlHomePage());

  expect(screen.queryByRole("heading", { name: /season complete/ })).not.toBeInTheDocument();
  expect(screen.getByText("No featured match right now")).toBeInTheDocument();
  expect(screen.queryByText("Make your pick")).not.toBeInTheDocument();
});
