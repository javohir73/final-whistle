/** Predicted vs actual: the board card labels the model's score and shows a
 *  verdict at full time; the match hero keeps the real-score slot for real
 *  scores ("vs" before kickoff), moves the model's most likely scoreline into a
 *  labelled chip, and grades the call only on a feed-confirmed result. */
import { render, screen } from "@testing-library/react";
import { MatchCard } from "@/components/MatchCard";
import { MatchHero } from "@/components/match/MatchHero";
import { ModelCallCard } from "@/components/match/ModelCallCard";
import type { ModelData } from "@/components/match/matchPageData";
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
  it("keeps the model's call hidden before kickoff (reveal rule)", () => {
    render(<MatchCard match={base} href={HREF} />);
    expect(screen.queryByText("1–0")).not.toBeInTheDocument();
    expect(screen.getByText(/appears once you lock yours/)).toBeInTheDocument();
  });

  it("at full time shows actual score, the model-labelled prediction, and a verdict", () => {
    render(<MatchCard match={finished} href={HREF} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("Full time")).toBeInTheDocument();
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByText("1–0")).toBeInTheDocument();
    expect(screen.getByText("Right result")).toBeInTheDocument();
  });

  it("shows the kickoff time (not a confidence badge) before kickoff", () => {
    render(<MatchCard match={{ ...base, kickoff_utc: "2099-06-11T19:00:00+00:00" }} tz="UTC" href={HREF} />);
    expect(screen.getByText("7:00 PM")).toBeInTheDocument();
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
  });

  it("calls out a miss when the favoured side lost", () => {
    render(<MatchCard match={{ ...finished, score_home: 0, score_away: 2 }} href={HREF} />);
    expect(screen.getByText("Missed")).toBeInTheDocument();
  });
});

// The match hero and the model's call, rewritten from the deleted
// MatchScoreboard onto its replacements (MatchHero + ModelCallCard). The model's
// call is no longer in the hero at all; whether it shows is the reveal rule's
// job (covered in app/match/[id]/MatchPageContent.test.tsx).
describe("MatchHero + ModelCallCard (the match page)", () => {
  const team = (name: string) => ({ name, href: null, standing: null });
  const renderHero = (s: MatchSummary | null, phase: Parameters<typeof MatchHero>[0]["phase"]) =>
    render(
      <MatchHero competitionLabel="World Cup 2026" home={team("Mexico")} away={team("South Africa")}
        kickoffUtc={s?.kickoff_utc ?? FUTURE_KICKOFF} venue="Estadio Azteca" summary={s} phase={phase} />,
    );
  const data: ModelData = {
    probabilities: base.probabilities!,
    predicted: base.predicted_score!,
    confidence: "High",
    reasons: [],
    goalMarkets: null,
  };

  beforeEach(() => window.localStorage.setItem("pp:timezone", JSON.stringify({ tz: "UTC", confirmed: true })));

  it("keeps the centre slot for real scores: the kick-off time before, never the model's score", () => {
    const { container } = renderHero(base, "upcoming");
    expect(screen.getByText("kick-off")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/1–0|60%|High/);
  });

  it("carries the date and the venue in the eyebrow", () => {
    renderHero({ ...base, kickoff_utc: "2099-06-20T19:00:00Z" }, "upcoming");
    expect(screen.getByText("World Cup 2026 · Saturday 20 June · Estadio Azteca")).toBeInTheDocument();
    expect(screen.getByText("7:00 pm")).toBeInTheDocument();
  });

  it("promotes the live score with an estimated minute", () => {
    renderHero(live, "live");
    expect(screen.getByRole("status")).toHaveTextContent("Live: Mexico 1–0 South Africa");
    expect(screen.getByText(/Live · 63' est\./)).toBeInTheDocument();
  });

  it("shows HT at half-time instead of a ticking minute", () => {
    renderHero(halfTime, "live");
    expect(screen.getByText(/Live · HT/)).toBeInTheDocument();
    expect(screen.queryByText(/\d+' est\./)).not.toBeInTheDocument();
  });

  it("shows PENS, the level score, and the live shootout tally during a shootout", () => {
    renderHero(shootout, "live");
    expect(screen.getByText(/Live · PENS/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Mexico 1–1 South Africa");
    expect(screen.getByText("5–4 on penalties")).toBeInTheDocument();
  });

  it("at full time: the result in the hero, the call graded below", () => {
    renderHero(finished, "finished");
    expect(screen.getByText("Full time")).toBeInTheDocument();
    render(<ModelCallCard home="Mexico" away="South Africa" data={data} mode="finished" pick={null} result={{ home: 2, away: 0 }} />);
    expect(screen.getByText("Right result · 2 points")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Mexico 60%, draw 25%, South Africa 15%" })).toBeInTheDocument();
  });

  it("never infers full time from a stranded in_play: Result pending, no verdict", () => {
    renderHero(stranded, "stale");
    expect(screen.getByText("Result pending")).toBeInTheDocument();
    expect(screen.queryByText("Full time")).not.toBeInTheDocument();
    render(<ModelCallCard home="Mexico" away="South Africa" data={data} mode="made" pick={null} result={null} />);
    expect(screen.queryByText(/points/)).not.toBeInTheDocument();
  });

  it("falls back to the kick-off when no summary is available", () => {
    renderHero(null, "upcoming");
    expect(screen.getByText("kick-off")).toBeInTheDocument();
  });
});
