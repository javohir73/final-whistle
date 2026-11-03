/** Predicted vs actual: the board card labels the model's score and shows a
 *  verdict at full time; the match hero keeps the real-score slot for real
 *  scores ("vs" before kickoff), moves the model's most likely scoreline into a
 *  labelled chip, and grades the call only on a feed-confirmed result. */
import { render, screen } from "@testing-library/react";
import { MatchCard } from "@/components/MatchCard";
import { MatchScoreboard } from "@/components/MatchScoreboard";
import * as api from "@/lib/api";
import type { MatchSummary } from "@/lib/types";

jest.mock("@/lib/api");
const mockGetMatchSummary = api.getMatchSummary as jest.Mock;

const HREF = "/football/wc26/match/1";
// An upcoming fixture: a scheduled row whose kickoff is long past reads
// "Result pending" (matchPhase), so the pre-match fixture is dated ahead.
const FUTURE_KICKOFF = new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString();

const base: MatchSummary = {
  match_id: 1,
  stage: "group",
  group: "Group A",
  kickoff_utc: FUTURE_KICKOFF,
  venue: "Estadio Azteca",
  venue_city: "Mexico City",
  venue_country: "Mexico",
  is_neutral: false,
  status: "scheduled",
  score_home: null,
  score_away: null,
  minute: null,
  period: null,
  injury_time: null,
  penalty_home: null,
  penalty_away: null,
  teams: { home: "Mexico", away: "South Africa" },
  predicted_winner: "Mexico",
  probabilities: { home_win: 0.6, draw: 0.25, away_win: 0.15 },
  predicted_score: { home: 1, away: 0, probability: 0.18 },
  confidence: "High",
  goal_events: [],
};

// A live match must have a recent kickoff (isLiveNow bounds the live window),
// so derive it relative to now rather than a fixed date that goes stale.
const RECENT_KICKOFF = new Date(Date.now() - 60 * 60_000).toISOString();
const PAST_KICKOFF = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
const finished: MatchSummary = {
  ...base, kickoff_utc: PAST_KICKOFF, status: "finished", score_home: 2, score_away: 0,
};
const live: MatchSummary = {
  ...base, kickoff_utc: RECENT_KICKOFF, status: "in_play",
  score_home: 1, score_away: 0, minute: 63, period: "second_half",
};
const halfTime: MatchSummary = {
  ...base, kickoff_utc: RECENT_KICKOFF, status: "in_play",
  score_home: 1, score_away: 0, minute: null, period: "half_time",
};
const shootout: MatchSummary = {
  ...base, kickoff_utc: RECENT_KICKOFF, status: "in_play", score_home: 1, score_away: 1,
  minute: null, period: "penalty_shootout", penalty_home: 5, penalty_away: 4,
};
// The feed stalled: still in_play eight hours after kickoff.
const stranded: MatchSummary = {
  ...base, kickoff_utc: new Date(Date.now() - 8 * 60 * 60_000).toISOString(), status: "in_play",
  score_home: 1, score_away: 0, minute: 90, period: "second_half",
};

beforeEach(() => {
  mockGetMatchSummary.mockResolvedValue(finished);
});
afterEach(() => {
  jest.resetAllMocks();
  window.localStorage.clear();
});

describe("MatchCard", () => {
  it("shows a plain-language call before kickoff (no result yet)", () => {
    render(<MatchCard match={base} href={HREF} />);
    // home_win 0.6 clears 55% → "Mexico favoured".
    expect(screen.getByText("Mexico favoured")).toBeInTheDocument();
    // ML-model-labelled predicted scoreline, no promoted actual score.
    expect(screen.getByText("ML model")).toBeInTheDocument();
    expect(screen.getByText("1–0")).toBeInTheDocument();
  });

  it("at full time shows actual score, ML-model-labelled prediction, and a verdict", () => {
    render(<MatchCard match={finished} href={HREF} />);
    // Actual score per team row…
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    // …a "Full time" status pill (not a confidence badge)…
    expect(screen.getByText("Full time")).toBeInTheDocument();
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
    // …prediction explicitly labelled as the model's call…
    expect(screen.getByText("ML model")).toBeInTheDocument();
    expect(screen.getByText("1–0")).toBeInTheDocument();
    // …and the plain-language scorecard.
    expect(screen.getByText("Called it")).toBeInTheDocument();
  });

  it("shows an amber kickoff-time pill (not a confidence badge) before kickoff", () => {
    // tz is required for the time pill to render in the user's local time.
    render(<MatchCard match={{ ...base, kickoff_utc: "2099-06-11T19:00:00+00:00" }} tz="UTC" href={HREF} />);
    expect(screen.getByText("7:00 PM")).toBeInTheDocument();
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
  });

  it("calls out a miss when the favoured side lost", () => {
    render(<MatchCard match={{ ...finished, score_home: 0, score_away: 2 }} href={HREF} />);
    expect(screen.getByText("Upset — we missed it")).toBeInTheDocument();
  });
});

describe("MatchScoreboard (the match hero)", () => {
  const renderBoard = (initialSummary: MatchSummary | null) =>
    render(
      <MatchScoreboard
        matchId={1}
        home="Mexico"
        away="South Africa"
        homeTeamId={10}
        awayTeamId={20}
        kickoffUtc={initialSummary?.kickoff_utc ?? FUTURE_KICKOFF}
        probabilities={base.probabilities!}
        predicted={base.predicted_score!}
        initialSummary={initialSummary}
        confidence="High"
      />,
    );

  it("keeps the score slot for real scores: 'vs' before kickoff, the model's score in a labelled chip", () => {
    mockGetMatchSummary.mockResolvedValue(base);
    renderBoard(base);
    expect(screen.getByText("vs")).toBeInTheDocument();
    expect(screen.queryByText(/MOST LIKELY SCORE/i)).not.toBeInTheDocument();
    // The predicted score appears exactly once, labelled as the model's.
    expect(screen.getByText("Most likely 1–0 · 18%")).toBeInTheDocument();
    expect(screen.queryByText("1–0")).not.toBeInTheDocument();
  });

  it("says the model's call in one sentence over one labelled bar, with the tier as a chip", () => {
    mockGetMatchSummary.mockResolvedValue(base);
    renderBoard(base);
    expect(screen.getByText("Model's call")).toBeInTheDocument();
    expect(screen.getByText("Mexico favoured")).toBeInTheDocument();
    // ONE bar in the whole hero, and its numbers sum to 100.
    expect(screen.getAllByRole("img", { name: /win/ })).toHaveLength(1);
    expect(
      screen.getByRole("img", { name: "Mexico win 60%, draw 25%, South Africa win 15%" }),
    ).toBeInTheDocument();
    expect(screen.getByText("High confidence")).toBeInTheDocument();
    // The tier is a chip, not a second rendering of the % in a ring.
    expect(screen.queryByText("HIGH")).not.toBeInTheDocument();
  });

  it("carries the kickoff date and timezone (not just clock time) in the upcoming status line", () => {
    // Pin the zone via storage so the assertion is deterministic.
    window.localStorage.setItem(
      "pp:timezone",
      JSON.stringify({ tz: "Europe/London", confirmed: true }),
    );
    const upcoming = { ...base, kickoff_utc: "2099-06-20T19:00:00Z" };
    mockGetMatchSummary.mockResolvedValue(upcoming);
    render(
      <MatchScoreboard
        matchId={1}
        home="Mexico"
        away="South Africa"
        probabilities={base.probabilities!}
        predicted={base.predicted_score!}
        initialSummary={upcoming}
        kickoffUtc="2099-06-20T19:00:00Z"
        venue="Wembley"
      />,
    );
    // The tz label form (BST vs GMT+1) is ICU-version dependent, so assert only
    // that a non-empty zone label sits between the clock and the venue.
    expect(screen.getByText(/20 Jun · 8:00 PM .+ · Wembley/)).toBeInTheDocument();
  });

  it("promotes the live score to the scorebug with an estimated minute", () => {
    mockGetMatchSummary.mockResolvedValue(live);
    renderBoard(live);
    expect(screen.getByText("1–0")).toBeInTheDocument(); // actual (1–0 at 63')
    expect(screen.getByText(/LIVE · 63' est\./)).toBeInTheDocument();
    expect(screen.getByText("Model predicted 1–0")).toBeInTheDocument();
    expect(screen.getByText("Pre-match: Mexico favoured")).toBeInTheDocument();
  });

  it("labels the in-play probability as the live win chance when the feed carries one", () => {
    const withLive = { ...live, live_probabilities: { home_win: 0.81, draw: 0.14, away_win: 0.05 } };
    mockGetMatchSummary.mockResolvedValue(withLive);
    renderBoard(withLive);
    expect(screen.getByText("Live win chance")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Mexico win 81%, draw 14%, South Africa win 5%" })).toBeInTheDocument();
  });

  it("shows HT at half-time instead of a ticking minute", () => {
    mockGetMatchSummary.mockResolvedValue(halfTime);
    renderBoard(halfTime);
    expect(screen.getByText(/LIVE.*HT/)).toBeInTheDocument();
    expect(screen.queryByText(/\d+' est\./)).not.toBeInTheDocument();
  });

  it("shows PENS, the 90-minute score, and the live shootout tally during a shootout", () => {
    mockGetMatchSummary.mockResolvedValue(shootout);
    renderBoard(shootout);
    expect(screen.getByText(/LIVE.*PENS/)).toBeInTheDocument();
    expect(screen.getByText("1–1")).toBeInTheDocument(); // level after 90/ET
    expect(screen.getByText(/5–4 pens/)).toBeInTheDocument();
  });

  it("at full time shows actual + predicted + verdict together", () => {
    renderBoard(finished);
    expect(screen.getByText("2–0")).toBeInTheDocument(); // actual headline
    expect(screen.getByText("FULL TIME")).toBeInTheDocument();
    expect(screen.getByText("Model predicted 1–0")).toBeInTheDocument(); // prediction kept visible
    expect(screen.getByText("Result predicted right")).toBeInTheDocument();
  });

  it("never infers full time from a stranded in_play: Result pending, no verdict", () => {
    mockGetMatchSummary.mockResolvedValue(stranded);
    renderBoard(stranded);
    expect(screen.getByText("RESULT PENDING")).toBeInTheDocument();
    expect(screen.queryByText(/FULL TIME/)).not.toBeInTheDocument();
    expect(screen.getByText("1–0")).toBeInTheDocument(); // last known score
    expect(screen.queryByText("Exact score predicted")).not.toBeInTheDocument();
    expect(screen.queryByText(/Result predicted right|Model missed/)).not.toBeInTheDocument();
  });

  it("falls back to prediction-only when no summary is available", async () => {
    mockGetMatchSummary.mockRejectedValue(new Error("offline"));
    renderBoard(null);
    expect(screen.getByText("vs")).toBeInTheDocument(); // upcoming scorebug
    expect(screen.getByText("Most likely 1–0 · 18%")).toBeInTheDocument();
    await screen.findByText("Mexico favoured");
  });
});
