/** FeatureHero (direction G): one featured match as a calm card with real
 *  crests and the next step. Reveal rule: the model's scoreline, leading
 *  chance and margin stay hidden on an open fixture until the viewer locks a
 *  pick (never in the server HTML); finished/live matches and competitions
 *  without a pick game show it. `match={null}` is an honest placeholder. */
import { render, screen, waitFor } from "@testing-library/react";
import { FeatureHero } from "@/components/FeatureHero";
import { getMyLeagueTips } from "@/lib/leagueTips";
import { resetRevealStore } from "@/lib/useModelReveal";
import type { LeagueTipsMineResponse, MatchSummary } from "@/lib/types";

jest.mock("@/lib/leagueTips");
jest.mock("@/lib/nrlTips");
jest.mock("@/lib/session", () => {
  const actual = jest.requireActual("@/lib/session");
  return { ...actual, getOrCreateDeviceId: jest.fn(() => "device-1") };
});
const mockMine = getMyLeagueTips as jest.MockedFunction<typeof getMyLeagueTips>;

function makeMatch(overrides: Partial<MatchSummary> = {}): MatchSummary {
  return {
    match_id: 101,
    stage: "group",
    group: "Group C",
    kickoff_utc: new Date(Date.now() + 3 * 3_600_000).toISOString(),
    venue: "Estadio Test",
    venue_city: "Test City",
    venue_country: "Testland",
    is_neutral: true,
    status: "scheduled",
    score_home: null,
    score_away: null,
    minute: null,
    period: null,
    injury_time: null,
    penalty_home: null,
    penalty_away: null,
    teams: { home: "Brazil", away: "Uruguay" },
    predicted_winner: "Brazil",
    probabilities: { home_win: 0.62, draw: 0.24, away_win: 0.14 },
    predicted_score: { home: 2, away: 0, probability: 0.1 },
    confidence: "High",
    goal_events: [],
    matchweek: 11,
    ...overrides,
  };
}

const week = (matches: LeagueTipsMineResponse["matches"]): LeagueTipsMineResponse => ({
  league: "epl", matchweek: 11, handle: null, matches, disclaimer: "",
});

beforeEach(() => {
  resetRevealStore();
  window.localStorage.clear();
  mockMine.mockReset();
  mockMine.mockResolvedValue(week([]));
});

describe("FeatureHero reveal rule", () => {
  it("hides the model's numbers on an open fixture with no locked pick", async () => {
    const { container } = render(<FeatureHero match={makeMatch()} comp="epl" tz="UTC" />);
    await waitFor(() => expect(mockMine).toHaveBeenCalled());
    expect(container).not.toHaveTextContent("2–0");
    expect(container).not.toHaveTextContent(/62|%/);
    expect(screen.getByText(/appears once you lock yours/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Why/ })).toBeNull();
  });

  it("keeps them out of the server HTML", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    if (!g.TextEncoder) g.TextEncoder = jest.requireActual("node:util").TextEncoder;
    const server = jest.requireActual("react-dom/server.node") as typeof import("react-dom/server");
    const html = server.renderToString(<FeatureHero match={makeMatch()} comp="epl" tz="UTC" />);
    expect(html).not.toContain("2–0");
    expect(html).not.toContain("62%");
  });

  it("reveals You and Model after a locked pick", async () => {
    mockMine.mockResolvedValue(
      week([
        {
          id: 101, home: "Brazil", away: "Uruguay", kickoff_utc: null, status: "scheduled",
          score_home: null, score_away: null, model: null,
          your_prediction: { predicted_home: 3, predicted_away: 1, points: null, exact: null, graded_at: null, updated_at: null },
        },
      ]),
    );
    render(<FeatureHero match={makeMatch()} comp="epl" tz="UTC" />);
    expect(await screen.findByText("3–1")).toBeInTheDocument();
    expect(screen.getByText("2–0")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Why the model thinks so" })).toHaveAttribute(
      "href",
      "/football/epl/match/101#why",
    );
  });

  it("shows the call where there is no pick game (Champions League)", () => {
    render(<FeatureHero match={makeMatch()} comp="ucl" tz="UTC" />);
    expect(screen.getByText("2–0")).toBeInTheDocument();
    expect(screen.getByText(/Brazil win 62%/)).toBeInTheDocument();
  });

  it("keeps an open NRL margin hidden", () => {
    const { container } = render(
      <FeatureHero match={makeMatch({ predicted_score: null })} comp="nrl" tz="UTC" margin={5.5} />,
    );
    expect(container).not.toHaveTextContent("by 5.5");
  });
});

describe("FeatureHero", () => {
  it("renders an honest placeholder for a null match", () => {
    render(<FeatureHero match={null} comp="wc26" />);
    expect(screen.getByText("No featured match right now")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("dates the kickoff and names its zone", () => {
    render(<FeatureHero match={makeMatch({ kickoff_utc: "2099-11-08T15:00:00Z" })} comp="epl" tz="Europe/London" />);
    expect(screen.getByText(/^Sun 8 Nov · 3:00 PM \S+$/)).toBeInTheDocument();
  });

  it("accepts the eyebrow copy", () => {
    render(<FeatureHero match={makeMatch()} comp="epl" tz="UTC" eyebrow="Next up" />);
    expect(screen.getByText("Next up")).toBeInTheDocument();
  });

  it("drops the CTA link when href is null -- never falls through to /match/<id>", () => {
    render(<FeatureHero match={makeMatch()} comp="nrl" tz="UTC" badge="club" href={null} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("button", { name: "Make your pick" })).toBeDisabled();
  });

  it('badge="club" uses real club crests, decorative beside the printed names', () => {
    const { container } = render(
      <FeatureHero match={makeMatch({ teams: { home: "Panthers", away: "Eels" } })} comp="nrl" tz="UTC" badge="club" />,
    );
    expect(container.querySelector('[data-club-logo="Panthers"] img')).toHaveAttribute("src", "/clubs/nrl/panthers.svg");
    expect(container.querySelector('[data-club-logo="Eels"] img')).toHaveAttribute("src", "/clubs/nrl/eels.svg");
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });
});

describe("FeatureHero primary call to action", () => {
  const live = () =>
    makeMatch({
      kickoff_utc: new Date(Date.now() - 30 * 60_000).toISOString(),
      status: "in_play", score_home: 1, score_away: 0, minute: 30, period: "first_half",
    });

  it("sends a pre-kickoff league fixture to the pick", () => {
    render(<FeatureHero match={makeMatch()} comp="epl" tz="UTC" />);
    expect(screen.getByRole("link", { name: "Make your pick" })).toHaveAttribute("href", "/football/epl/match/101#pick");
  });

  it("routes through the href override", () => {
    render(<FeatureHero match={makeMatch()} comp="epl" tz="UTC" href="/football/epl/match/7" />);
    expect(screen.getByRole("link", { name: "Make your pick" })).toHaveAttribute("href", "/football/epl/match/7#pick");
  });

  it("offers a Preview -- no #pick -- where picks are not open (Champions League)", () => {
    render(<FeatureHero match={makeMatch()} comp="ucl" tz="UTC" />);
    expect(screen.queryByText("Make your pick")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Preview" })).toHaveAttribute("href", "/football/ucl/match/101");
  });

  it("says Live now for a live featured match, and shows the call", () => {
    render(<FeatureHero match={live()} comp="epl" tz="UTC" />);
    expect(screen.getByRole("link", { name: "Live now" })).toHaveAttribute("href", "/football/epl/match/101");
    expect(screen.getByText("2–0")).toBeInTheDocument();
  });

  it("says Match centre once the match is over", () => {
    render(
      <FeatureHero
        match={makeMatch({ status: "finished", score_home: 2, score_away: 0, kickoff_utc: new Date(Date.now() - 2 * 86_400_000).toISOString() })}
        comp="epl"
        tz="UTC"
      />,
    );
    expect(screen.getByRole("link", { name: "Match centre" })).toHaveAttribute("href", "/football/epl/match/101");
  });

  it("sends an NRL pick to the NRL tips game", () => {
    render(<FeatureHero match={makeMatch()} comp="nrl" tz="UTC" href="/nrl/match/2026/19/3" />);
    expect(screen.getByRole("link", { name: "Make your pick" })).toHaveAttribute("href", "/nrl/tips");
  });
});
