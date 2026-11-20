/** MatchHero replaces the old Scorebug/MatchScoreboard. Its centre slot is
 *  for REAL scores only: the kick-off time before the match, the live score
 *  or the full-time score after -- never the model's predicted score, and no
 *  chance bar (the model's call lives below, behind the reveal rule). */
import { render, screen } from "@testing-library/react";
import { MatchHero } from "./MatchHero";
import type { MatchSummary } from "@/lib/types";

function summary(over: Partial<MatchSummary> = {}): MatchSummary {
  return {
    match_id: 1, stage: "group", group: null, kickoff_utc: "2026-11-21T15:00:00Z",
    venue: "Etihad Stadium", venue_city: null, venue_country: null, is_neutral: false,
    status: "scheduled", score_home: null, score_away: null, minute: null,
    period: null, injury_time: null, penalty_home: null, penalty_away: null,
    goal_events: [], teams: { home: "Manchester City", away: "Arsenal" },
    predicted_winner: "Manchester City", probabilities: { home_win: 0.5, draw: 0.25, away_win: 0.25 },
    predicted_score: { home: 3, away: 1, probability: 0.1 }, confidence: "High",
    ...over,
  };
}

const teams = {
  home: { name: "Manchester City", href: "/football/epl/team/353", standing: { teamId: 353, team: "Manchester City", pos: 3, won: 7, drawn: 0, lost: 3, gd: 8, points: 21 } },
  away: { name: "Arsenal", href: "/football/epl/team/339", standing: null },
};

beforeEach(() => localStorage.setItem("pp:timezone", JSON.stringify({ tz: "UTC", confirmed: true })));
afterEach(() => localStorage.clear());

test("before kick-off: eyebrow, real crests, kick-off time -- never the model's score or bar", () => {
  const { container } = render(
    <MatchHero competitionLabel="Premier League" {...teams} kickoffUtc="2026-11-21T15:00:00Z" venue="Etihad Stadium" summary={summary()} phase="upcoming" />,
  );
  expect(screen.getByRole("heading", { level: 1, name: "Manchester City v Arsenal" })).toBeInTheDocument();
  expect(screen.getByText("Premier League · Saturday 21 November · Etihad Stadium")).toBeInTheDocument();
  expect(screen.getByText("3:00 PM")).toBeInTheDocument();
  expect(screen.getByText("kick-off")).toBeInTheDocument();
  expect(screen.getByText("3rd · 21 points")).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/3–1|3 – 1|50%|High/);
  expect(screen.queryByRole("img", { name: /%/ })).not.toBeInTheDocument();
  // Crests are real images, decorative beside the printed names.
  expect(container.querySelector('[data-club-logo="Arsenal"] img')).toHaveAttribute("alt", "");
  expect(screen.getByRole("link", { name: /^Manchester City/ })).toHaveAttribute("href", "/football/epl/team/353");
  expect(screen.getByRole("link", { name: /^Arsenal/ })).toHaveAttribute("href", "/football/epl/team/339");
});

test("no venue: says so instead of inventing one", () => {
  render(<MatchHero competitionLabel="Premier League" {...teams} kickoffUtc={null} venue={null} summary={null} phase="upcoming" />);
  expect(screen.getByText("Premier League · Venue to be confirmed")).toBeInTheDocument();
  expect(screen.getByText("TBC")).toBeInTheDocument();
});

test("live: the real score, the minute, and one polite region with the score only", () => {
  const live = summary({ status: "in_play", score_home: 1, score_away: 0, minute: 63, period: "second_half" });
  render(<MatchHero competitionLabel="Premier League" {...teams} kickoffUtc={live.kickoff_utc} venue={null} summary={live} phase="live" />);
  expect(screen.getByRole("status")).toHaveTextContent(/^Live: Manchester City 1–0 Arsenal$/);
  expect(screen.getByText(/Live · 63' est\./)).toBeInTheDocument();
  expect(screen.getByText("Live, 63' (estimated)")).toHaveClass("sr-only");
});

test("full time: the result, labelled -- never inferred from a stranded feed", () => {
  const ft = summary({ status: "finished", score_home: 2, score_away: 2 });
  const { rerender } = render(
    <MatchHero competitionLabel="Premier League" {...teams} kickoffUtc={ft.kickoff_utc} venue={null} summary={ft} phase="finished" />,
  );
  expect(screen.getByText("Full time")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Full time: Manchester City 2–2 Arsenal");

  const stranded = summary({ status: "in_play", score_home: 2, score_away: 0 });
  rerender(<MatchHero competitionLabel="Premier League" {...teams} kickoffUtc={ft.kickoff_utc} venue={null} summary={stranded} phase="stale" />);
  expect(screen.getByText("Result pending")).toBeInTheDocument();
  expect(screen.queryByText("Full time")).not.toBeInTheDocument();
});

test("a deliberately stopped fixture says so in the centre", () => {
  const off = summary({ status: "cancelled" });
  render(<MatchHero competitionLabel="Premier League" {...teams} kickoffUtc={off.kickoff_utc} venue={null} summary={off} phase="cancelled" />);
  expect(screen.getByText("Cancelled")).toBeInTheDocument();
});
