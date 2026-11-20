import { render, screen } from "@testing-library/react";
import { MatchHero } from "@/components/match/MatchHero";
import type { MatchSummary } from "@/lib/types";

// Rewritten from the deleted MatchScoreboard onto its replacement, MatchHero.
const summary: MatchSummary = {
  match_id: 1, stage: "group", group: "Group A", kickoff_utc: null,
  venue: null, venue_city: null, venue_country: null, is_neutral: true,
  status: "finished", score_home: 2, score_away: 1, minute: null, period: null,
  injury_time: null, penalty_home: null, penalty_away: null,
  teams: { home: "Mexico", away: "South Africa" },
  predicted_winner: "Mexico", probabilities: null, predicted_score: null, confidence: null,
  goal_events: [
    { minute: 30, side: "home", player: "R. Jimenez", type: "goal" },
    { minute: 70, side: "away", player: "P. Kgatlana", type: "penalty" },
  ],
};

const team = (name: string) => ({ name, href: null, standing: null });

test("renders goalscorers under the score", () => {
  render(
    <MatchHero competitionLabel="World Cup 2026" home={team("Mexico")} away={team("South Africa")}
      kickoffUtc={null} venue={null} summary={summary} phase="finished" />,
  );
  expect(screen.getByText("R. Jimenez 30′")).toBeInTheDocument();
  expect(screen.getByText("P. Kgatlana 70′ (pen)")).toBeInTheDocument();
});

test("lists no scorers before kick-off", () => {
  render(
    <MatchHero competitionLabel="World Cup 2026" home={team("Mexico")} away={team("South Africa")}
      kickoffUtc={null} venue={null} summary={{ ...summary, status: "scheduled", score_home: null, score_away: null }} phase="upcoming" />,
  );
  expect(screen.queryByText(/R\. Jimenez/)).not.toBeInTheDocument();
});
