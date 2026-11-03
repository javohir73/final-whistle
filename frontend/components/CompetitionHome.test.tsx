/** CompetitionHome: the hero leads with the next fixture on its own
 *  competition-scoped match page (FeatureHero itself lands "Make your pick" on
 *  that page's #pick section); "Also on" is the window around that
 *  kickoff (never the season's opening fixtures); a played match is never
 *  featured. FeatureHero / MatchCard / StandingsTable are stubbed -- their
 *  own rendering is covered elsewhere and owned by the match-centre work. */
import { render, screen, within } from "@testing-library/react";
import { CompetitionHome } from "./CompetitionHome";
import { getGroups, getTeams, getUpcomingMatches } from "@/lib/api";
import type { MatchSummary, Team } from "@/lib/types";

jest.mock("@/lib/api");
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => "/football/epl" }));
jest.mock("@/components/FeatureHero", () => ({
  FeatureHero: ({ match, href, eyebrow }: { match: MatchSummary | null; href?: string | null; eyebrow?: string }) => (
    <div data-testid="feature" data-href={href ?? ""} data-eyebrow={eyebrow ?? ""}>
      {match ? `feature-${match.match_id}` : "no-feature"}
    </div>
  ),
}));
jest.mock("@/components/MatchCard", () => ({
  MatchCard: ({ match, href }: { match: MatchSummary; href?: string }) => (
    <div data-testid="card" data-href={href ?? ""}>{`card-${match.match_id}`}</div>
  ),
}));
jest.mock("@/components/StandingsTable", () => ({ StandingsTable: () => null }));

const mockTeams = getTeams as jest.MockedFunction<typeof getTeams>;
const mockGroups = getGroups as jest.MockedFunction<typeof getGroups>;
const mockUpcoming = getUpcomingMatches as jest.MockedFunction<typeof getUpcomingMatches>;

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();

function match(id: number, days: number, overrides: Partial<MatchSummary> = {}): MatchSummary {
  return {
    match_id: id, stage: "group", group: "Premier League", kickoff_utc: at(days),
    venue: null, venue_city: null, venue_country: null, is_neutral: false,
    status: days < 0 ? "finished" : "scheduled",
    score_home: days < 0 ? 1 : null, score_away: days < 0 ? 0 : null,
    minute: null, period: null, injury_time: null, penalty_home: null, penalty_away: null,
    teams: { home: `Home ${id}`, away: `Away ${id}` },
    predicted_winner: null,
    probabilities: { home_win: 0.5, draw: 0.3, away_win: 0.2 },
    predicted_score: { home: 1, away: 0, probability: 0.1 },
    confidence: "Medium",
    goal_events: [],
    ...overrides,
  };
}

const teams: Team[] = [
  { id: 1, name: "Arsenal", country_code: null, confederation: null, fifa_rank: null, elo_rating: 1900, is_host: false },
];

function renderHome(matches: MatchSummary[]) {
  mockTeams.mockResolvedValue(teams);
  mockGroups.mockResolvedValue([]);
  mockUpcoming.mockResolvedValue(matches);
  return render(
    <CompetitionHome competition="epl" initialTeams={teams} initialGroups={[]} initialMatches={matches} />,
  );
}

afterEach(() => jest.resetAllMocks());

// A season list in kickoff order, as /matches/upcoming returns it: August's
// opening results first, then this week's, then the rest of the season.
const season = [
  match(101, -80), match(102, -80), match(103, -79), match(104, -79),
  match(150, -1), // played yesterday: inside the window
  match(160, -2, { status: "scheduled", score_home: null, score_away: null }), // ghost row
  match(200, 2), // next kickoff -> the feature
  match(201, 3), match(202, 3.5), match(203, 4.5),
  match(300, 16), match(301, 17),
];

it("features the next fixture, linked to its competition-scoped match page", () => {
  renderHome(season);

  const feature = screen.getByTestId("feature");
  expect(feature).toHaveTextContent("feature-200");
  // Bare page href: FeatureHero appends #pick / #why per CTA, so passing an
  // anchor here would double it.
  expect(feature).toHaveAttribute("data-href", "/football/epl/match/200");
});

it("'Also on' is the window around the next kickoff, not the season's opening fixtures", () => {
  renderHome(season);

  const section = screen.getByRole("region", { name: "Also on" });
  const cards = within(section).getAllByTestId("card").map((c) => c.textContent);
  // Upcoming first (kickoff order), then the most recent result; never
  // August's matchweek 1, never the ghost row, never next fortnight.
  expect(cards).toEqual(["card-201", "card-202", "card-203", "card-150"]);
  expect(within(section).getAllByTestId("card")[0]).toHaveAttribute("data-href", "/football/epl/match/201");
});

it("never features a played match, and falls back to the latest results", () => {
  renderHome([match(101, -80), match(102, -40), match(103, -30), match(104, -20), match(105, -10)]);

  expect(screen.getByTestId("feature")).toHaveTextContent("no-feature");
  const section = screen.getByRole("region", { name: "Latest results" });
  expect(within(section).getAllByTestId("card").map((c) => c.textContent)).toEqual([
    "card-105", "card-104", "card-103", "card-102",
  ]);
});

it("leads with a live match over the next kickoff", () => {
  renderHome([
    match(400, -0.02, { status: "in_play", score_home: 0, score_away: 0, minute: 20 }),
    match(401, 1),
  ]);

  expect(screen.getByTestId("feature")).toHaveTextContent("feature-400");
});
