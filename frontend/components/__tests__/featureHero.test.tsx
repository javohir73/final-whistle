/** FeatureHero (Floodlight P2 slice p2-s5): the home hub's "tonight's feature"
 *  match -- a giant win % at display-hero scale, a thin W/D/L bar whose
 *  printed-% aria-label is the accessible source of truth for that number, two
 *  CTAs into the match page, and the league accent chip. `match={null}` degrades
 *  to an honest placeholder, never a fabricated number. */
import { render, screen } from "@testing-library/react";
import { FeatureHero } from "@/components/FeatureHero";
import type { MatchSummary } from "@/lib/types";

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
    ...overrides,
  };
}

describe("FeatureHero", () => {
  it("renders the giant win %, an accessible probability bar, both CTAs, and the comp chip", () => {
    render(<FeatureHero match={makeMatch()} comp="wc26" tz="UTC" />);

    // The decorative-scale giant number (max of home/draw/away = 62).
    expect(screen.getByText("62")).toBeInTheDocument();

    // The bar's printed-% aria-label is the accessible source of truth for it.
    const bar = screen.getByRole("img");
    expect(bar).toHaveAttribute("aria-label", expect.stringContaining("62%"));

    // Two CTAs into the competition-scoped match page, each landing on its
    // own section: the pick and the "why". The legacy /match/<id> default
    // 308s into the World Cup and soft-404s for every club match.
    expect(screen.getByRole("link", { name: "Make your pick" })).toHaveAttribute(
      "href",
      "/football/wc26/match/101#pick",
    );
    expect(screen.getByRole("link", { name: "Why 62%?" })).toHaveAttribute(
      "href",
      "/football/wc26/match/101#why",
    );

    // The league accent chip carries the competition's short label.
    expect(screen.getByText("WC26")).toBeInTheDocument();
  });

  it("renders an honest placeholder for a null match -- never a fabricated %", () => {
    render(<FeatureHero match={null} comp="wc26" />);

    expect(screen.getByText("No featured match right now")).toBeInTheDocument();
    // No probability bar, no CTAs, no invented percentage.
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("routes both CTAs through the href override, onto the sections that exist", () => {
    render(
      <FeatureHero match={makeMatch()} comp="epl" tz="UTC" href="/football/epl/match/101" />,
    );
    expect(screen.getByRole("link", { name: "Make your pick" })).toHaveAttribute(
      "href",
      "/football/epl/match/101#pick",
    );
    expect(screen.getByRole("link", { name: "Why 62%?" })).toHaveAttribute(
      "href",
      "/football/epl/match/101#why",
    );
  });

  it("points NRL's 'Why' at the NRL match page's model section (it has no #why or #pick)", () => {
    render(
      <FeatureHero match={makeMatch()} comp="nrl" tz="UTC" href="/nrl/match/2026/19/3" />,
    );
    expect(screen.getByRole("link", { name: "Make your pick" })).toHaveAttribute(
      "href",
      "/nrl/match/2026/19/3",
    );
    expect(screen.getByRole("link", { name: "Why 62%?" })).toHaveAttribute(
      "href",
      "/nrl/match/2026/19/3#model",
    );
  });

  it("dates the kickoff and names its zone, not a bare clock time", () => {
    render(
      <FeatureHero
        match={makeMatch({ kickoff_utc: "2026-11-08T15:00:00Z" })}
        comp="epl"
        tz="Europe/London"
      />,
    );
    // Sun 8 Nov · 3:00 PM GMT — the tz label form is ICU-dependent, so only
    // require that a non-empty zone label follows the clock time.
    expect(screen.getByText(/^Sun 8 Nov · 3:00 PM \S+$/)).toBeInTheDocument();
  });

  it("accepts truthful feature copy when the match is not tonight", () => {
    render(<FeatureHero match={makeMatch()} comp="epl" tz="UTC" eyebrow="Next up" />);

    expect(screen.getByText("Next up")).toBeInTheDocument();
    expect(screen.queryByText("Tonight's feature")).toBeNull();
  });

  it("drops both CTA links when href is null -- never falls through to /match/<id>", () => {
    // An NRL fixture whose round is still TBC (nrlMatchHref -> null): the CTAs
    // must degrade to non-interactive labels, not the football detail route.
    render(<FeatureHero match={makeMatch()} comp="nrl" tz="UTC" badge="club" href={null} />);

    expect(screen.queryByRole("link")).toBeNull();
    // The labels stay for layout, but there's no link to the wrong sport.
    const primary = screen.getByText("Make your pick");
    const secondary = screen.getByText("Why 62%?");
    expect(primary).toHaveClass("opacity-disabled");
    expect(secondary).toHaveClass("opacity-disabled");
  });

  it("prints the expected margin in the caption when there's no predicted score", () => {
    // Brazil (home) leads on win probability, so it's the favoured side.
    render(
      <FeatureHero
        match={makeMatch({ predicted_score: null })}
        comp="nrl"
        tz="UTC"
        margin={5.5}
      />,
    );

    expect(screen.getByText(/AI most likely: Brazil by 5\.5/)).toBeInTheDocument();
  });

  it("badge=\"club\" swaps the country crests for self-hosted club logos", () => {
    const { container } = render(
      <FeatureHero
        match={makeMatch({ teams: { home: "Panthers", away: "Eels" } })}
        comp="nrl"
        tz="UTC"
        badge="club"
      />,
    );

    expect(container.querySelector('[data-club-logo="Panthers"] img')).toHaveAttribute(
      "src",
      "/clubs/nrl/panthers.svg",
    );
    expect(container.querySelector('[data-club-logo="Eels"] img')).toHaveAttribute(
      "src",
      "/clubs/nrl/eels.svg",
    );
  });
});
