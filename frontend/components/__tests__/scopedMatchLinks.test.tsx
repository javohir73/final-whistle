/** Default match/team links must not land a club fixture on a World Cup URL.
 *  Where the component knows its competition (groups and the official
 *  bracket only exist for WC26) it links the scoped page directly; where it
 *  does not (the embed's prediction payload, the cross-competition intel
 *  feed) it goes through the /match/:id lookup, which resolves the
 *  competition server-side -- it never guesses. */
import { render, screen } from "@testing-library/react";
import { GroupFixtureList } from "@/components/GroupFixtureList";
import { GroupTable } from "@/components/GroupTable";
import { GroupCard } from "@/components/GroupCard";
import { TeamFixtures } from "@/components/TeamFixtures";
import { EmbedPredictionCard } from "@/components/EmbedPredictionCard";
import { parseEmbedConfig } from "@/lib/embed-utils";
import { SITE_URL } from "@/lib/constants";
import type { MatchSummary, Prediction, StandingRow } from "@/lib/types";

const fixture = (id: number): MatchSummary =>
  ({
    match_id: id,
    stage: "group",
    group: "Group C",
    kickoff_utc: null,
    venue: null,
    venue_city: null,
    venue_country: null,
    is_neutral: true,
    status: "scheduled",
    score_home: null,
    score_away: null,
    minute: null,
    period: null,
    injury_time: null,
    penalty_home: null,
    penalty_away: null,
    goal_events: [],
    teams: { home: "Brazil", away: "Serbia" },
    predicted_winner: null,
    probabilities: null,
    predicted_score: null,
    confidence: null,
  }) as MatchSummary;

it("links group fixtures to the World Cup's scoped match pages", () => {
  render(<GroupFixtureList matches={[fixture(12)]} />);
  expect(screen.getByRole("link")).toHaveAttribute("href", "/football/wc26/match/12");
});

it("lets a caller scope group fixtures to another groups competition", () => {
  render(<GroupFixtureList matches={[fixture(12)]} competition="ucl" />);
  expect(screen.getByRole("link")).toHaveAttribute("href", "/football/ucl/match/12");
});

it("links group-table teams to the World Cup's scoped team pages by default", () => {
  const standings: StandingRow[] = [
    {
      team_id: 10,
      team: "Brazil",
      projected_points: 6,
      projected_goals_for: 4,
      projected_goal_diff: 3,
      qualification_prob: 0.9,
    },
  ];
  render(<GroupTable standings={standings} />);
  expect(screen.getByRole("link", { name: /Brazil/ })).toHaveAttribute(
    "href",
    "/football/wc26/team/10",
  );
});

it("sends the embed backlink through the /match/:id lookup, keeping utm_source", () => {
  const prediction = {
    match_id: 198,
    teams: { home: "Arsenal", away: "Spurs" },
    probabilities: { home_win: 0.5, draw: 0.3, away_win: 0.2 },
    predicted_score: { home: 1, away: 0, probability: 0.12 },
    confidence: "Medium",
    reasons: [],
  } as unknown as Prediction;
  render(<EmbedPredictionCard prediction={prediction} config={parseEmbedConfig({})} />);
  const backlink = screen.getByRole("link", { name: /Powered by/ });
  expect(backlink).toHaveAttribute("href", `${SITE_URL}/match/198?utm_source=embed`);
  // (The origin itself is fifa-wc26-prediction, so check the path.)
  expect(new URL(backlink.getAttribute("href")!).pathname).not.toContain("/football/wc26");
});

it("links a group card and its teams to the World Cup's scoped pages by default", () => {
  const group = {
    id: 3,
    name: "Group C",
    standings: [
      {
        team_id: 10,
        team: "Brazil",
        projected_points: 6,
        projected_goals_for: 4,
        projected_goal_diff: 3,
        qualification_prob: 0.9,
      },
    ],
  };
  render(<GroupCard group={group} />);
  expect(screen.getByRole("link", { name: /Group C/ })).toHaveAttribute(
    "href",
    "/football/wc26/groups/3",
  );
  expect(screen.getByRole("link", { name: /Brazil/ })).toHaveAttribute(
    "href",
    "/football/wc26/team/10",
  );
});

describe("TeamFixtures", () => {
  const upcoming = (id: number, competition?: string) =>
    ({
      ...fixture(id),
      teams: { home: "Arsenal", away: "Spurs" },
      kickoff_utc: new Date(Date.now() + 86_400_000).toISOString(),
      competition,
    }) as MatchSummary;

  it("uses the caller's scoped base path (the team page passes its own)", () => {
    render(
      <TeamFixtures matches={[upcoming(5)]} teamName="Arsenal" matchBasePath="/football/epl/match" />,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/football/epl/match/5");
  });

  it("falls back to each fixture's own competition when it is known", () => {
    render(<TeamFixtures matches={[upcoming(5, "laliga")]} teamName="Arsenal" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/football/laliga/match/5");
  });

  it("otherwise uses the /match/:id lookup, never a WC26 guess", () => {
    render(<TeamFixtures matches={[upcoming(5)]} teamName="Arsenal" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/match/5");
  });
});
