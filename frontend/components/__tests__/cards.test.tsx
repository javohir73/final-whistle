import { render, screen } from "@testing-library/react";
import { MatchHero } from "@/components/match/MatchHero";
import type { MatchSummary } from "@/lib/types";

// Rewritten from the deleted MatchScoreboard onto its replacement, MatchHero.
const summary: MatchSummary = {
  match_id: 1, stage: "group", group: "Group A", kickoff_utc: new Date(Date.now() - 70 * 60_000).toISOString(),
  venue: null, venue_city: null, venue_country: null, is_neutral: true,
  status: "in_play", score_home: 1, score_away: 0, minute: 70, period: "second_half",
  injury_time: null, penalty_home: null, penalty_away: null,
  teams: { home: "Mexico", away: "South Africa" },
  predicted_winner: "Mexico", probabilities: null, predicted_score: null, confidence: null,
  goal_events: [{ minute: 30, side: "home", player: "R. Jimenez", type: "goal" }],
  card_events: [
    { minute: 44, side: "away", player: "T. Mokoena", type: "red" },
    { minute: 20, side: "home", player: "J. Vasquez", type: "yellow" },
    { minute: 55, side: "home", player: "E. Alvarez", type: "yellow" },
  ],
};

const team = (name: string) => ({ name, href: null, standing: null });
const hero = (s: MatchSummary) => (
  <MatchHero competitionLabel="World Cup 2026" home={team("Mexico")} away={team("South Africa")}
    kickoffUtc={s.kickoff_utc} venue={null} summary={s} phase="live" />
);

test("red cards join the timeline; yellows stay out", () => {
  render(hero(summary));
  expect(screen.getByText("T. Mokoena 44′ (red card)")).toBeInTheDocument();
  expect(screen.queryByText(/J\. Vasquez|E\. Alvarez/)).not.toBeInTheDocument();
  expect(screen.getByText("R. Jimenez 30′")).toBeInTheDocument();
});

test("summary without card_events renders goals as before", () => {
  render(hero({ ...summary, card_events: undefined }));
  expect(screen.getByText("R. Jimenez 30′")).toBeInTheDocument();
  expect(screen.queryByText(/red card/)).not.toBeInTheDocument();
});
