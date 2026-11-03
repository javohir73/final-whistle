/** MatchCard restyle (Floodlight P2 slice p2-s2): the shared football fixture
 *  card keeps its scoreboard behavior (live ring, ProbabilityBar aria-label,
 *  detail link) and gains a `variant="compact"` row for dense lists.
 *
 *  Honesty rules (UX rebuild C1): FULL TIME only when the feed says finished
 *  (a stranded in_play reads "Result pending", with no verdict); a live minute
 *  the feed estimated says so; the card link comes from the caller (the old
 *  /match/<id> default soft-404s for club matches); and nothing interactive
 *  sits inside the link. */
import { render, screen, within } from "@testing-library/react";
import { MatchCard } from "@/components/MatchCard";
import { RenderClockContext } from "@/components/match/clock";
import { hydrateAcrossTime } from "@/components/match/hydrate.testutil";
import type { MatchSummary } from "@/lib/types";

const HREF = "/football/wc26/match/11";

function makeMatch(overrides: Partial<MatchSummary> = {}): MatchSummary {
  return {
    match_id: 11,
    stage: "group",
    group: "Group B",
    // Upcoming by default: a scheduled row whose kickoff is long past is
    // "Result pending" (matchPhase), not an upcoming fixture.
    kickoff_utc: new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString(),
    venue: "Lumen Field",
    venue_city: "Seattle",
    venue_country: "USA",
    is_neutral: false,
    status: "scheduled",
    score_home: null,
    score_away: null,
    minute: null,
    period: null,
    injury_time: null,
    penalty_home: null,
    penalty_away: null,
    teams: { home: "Argentina", away: "Japan" },
    predicted_winner: "Argentina",
    probabilities: { home_win: 0.65, draw: 0.2, away_win: 0.15 },
    predicted_score: { home: 2, away: 0, probability: 0.12 },
    confidence: "High",
    goal_events: [],
    ...overrides,
  };
}

describe("MatchCard (full variant, default)", () => {
  it("renders both team names, an accessible probability bar, and links to the caller's href", () => {
    const match = makeMatch();
    render(<MatchCard match={match} href={HREF} />);

    expect(screen.getAllByText("Argentina").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Japan").length).toBeGreaterThanOrEqual(1);

    const bar = screen.getByRole("img");
    expect(bar).toHaveAttribute("aria-label", "Argentina win 65%, draw 20%, Japan win 15%");

    expect(screen.getByRole("link")).toHaveAttribute("href", HREF);
  });

  it("labels every number on the bar legend with its outcome", () => {
    render(<MatchCard match={makeMatch()} href={HREF} />);
    expect(screen.getByText("65%").parentElement).toHaveTextContent("Argentina65%");
    expect(screen.getByText("Draw 20%")).toBeInTheDocument();
    expect(screen.getByText("15%").parentElement).toHaveTextContent("Japan15%");
  });

  it("keeps the interactive favourite star out of the card link", () => {
    window.localStorage.setItem("pp:favorites", JSON.stringify(["Argentina"]));
    render(<MatchCard match={makeMatch()} href={HREF} />);

    const link = screen.getByRole("link");
    // A <button> nested in an <a> is invalid HTML and a keyboard trap.
    expect(within(link).queryByRole("button")).toBeNull();
    // A favourited team still reads as one, non-interactively.
    expect(within(link).getByText("(favourite team)")).toHaveClass("sr-only");
    window.localStorage.clear();
  });

  it("shows the live ring treatment and an estimated live minute", () => {
    const liveMatch = makeMatch({
      // Recent kickoff so isLiveNow() reads it as actually live, not stale.
      kickoff_utc: new Date(Date.now() - 30 * 60_000).toISOString(),
      status: "in_play",
      score_home: 1,
      score_away: 1,
      minute: 34,
      period: "first_half",
    });
    render(<MatchCard match={liveMatch} href={HREF} />);

    expect(screen.getByRole("link")).toHaveClass("ring-1", "ring-loss/40");
    // The free feed's minute is a kickoff estimate: never shown as the clock.
    expect(screen.getByText("34' est.")).toBeInTheDocument();
    expect(screen.getByLabelText("Live, 34' (estimated)")).toBeInTheDocument();
  });

  it("says 'Result pending' -- not Full time, no verdict -- for an in_play row stranded past the live window", () => {
    const stranded = makeMatch({
      kickoff_utc: new Date(Date.now() - 8 * 60 * 60_000).toISOString(),
      status: "in_play",
      score_home: 2,
      score_away: 0,
      minute: 90,
      period: "second_half",
    });
    render(<MatchCard match={stranded} href={HREF} />);

    expect(screen.getByText("Result pending")).toBeInTheDocument();
    expect(screen.queryByText("Full time")).not.toBeInTheDocument();
    expect(screen.queryByText(/^LIVE$|est\./)).not.toBeInTheDocument();
    // The last known score stays visible; the model is not graded on it.
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText(/Called it|Exact score|missed/)).not.toBeInTheDocument();
  });

  it("says 'Full time' only once the feed confirms the match finished", () => {
    render(
      <MatchCard
        match={makeMatch({ status: "finished", score_home: 3, score_away: 1 })}
        href={HREF}
      />,
    );
    expect(screen.getByText("Full time")).toBeInTheDocument();
    expect(screen.getByText("Called it")).toBeInTheDocument();
  });

  it("labels a postponed fixture without showing its stale kickoff", () => {
    render(
      <MatchCard
        match={makeMatch({ status: "postponed", kickoff_utc: "2026-08-21T19:00:00Z" })}
        tz="UTC"
        href={HREF}
      />,
    );

    expect(screen.getByText("Postponed")).toBeInTheDocument();
    expect(screen.queryByText("19:00")).not.toBeInTheDocument();
  });

  it.each(["cancelled", "suspended"] as const)(
    "labels %s and suppresses the model scoreline",
    (status) => {
      render(<MatchCard match={makeMatch({ status })} tz="UTC" href={HREF} />);

      expect(screen.getByText(status === "cancelled" ? "Cancelled" : "Suspended")).toBeInTheDocument();
      expect(screen.queryByText("2–0")).not.toBeInTheDocument();
    },
  );
});

describe("MatchCard (variant=\"compact\")", () => {
  it("still links to the match detail page and keeps the live ring", () => {
    const liveMatch = makeMatch({
      kickoff_utc: new Date(Date.now() - 10 * 60_000).toISOString(),
      status: "in_play",
      minute: 12,
      period: "first_half",
    });
    render(<MatchCard match={liveMatch} variant="compact" href={HREF} />);

    expect(screen.getByRole("link")).toHaveAttribute("href", HREF);
    expect(screen.getByRole("link")).toHaveClass("ring-1", "ring-loss/40");
    expect(screen.getByText("12' est.")).toBeInTheDocument();
  });

  it("reads 'Result pending' for a scheduled row whose kickoff is long past", () => {
    const overdue = makeMatch({ kickoff_utc: new Date(Date.now() - 5 * 60 * 60_000).toISOString() });
    render(<MatchCard match={overdue} variant="compact" href={HREF} tz="UTC" />);
    expect(screen.getByText("Result pending")).toBeInTheDocument();
  });

  it("logs a missing href once and falls back to the legacy lookup path", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    render(<MatchCard match={makeMatch()} variant="compact" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/match/11");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("MatchCard rendered without an href"));
    warn.mockRestore();
  });

  it("shows a lime lead percentage for a >=60% favorite", () => {
    const match = makeMatch({ probabilities: { home_win: 0.72, draw: 0.18, away_win: 0.1 } });
    render(<MatchCard match={match} variant="compact" href={HREF} />);

    const lead = screen.getByText("72%");
    expect(lead).toHaveClass("text-lime-deep");
  });

  it("shows Venue TBC when the provider has not confirmed a stadium", () => {
    render(
      <MatchCard
        match={makeMatch({ venue: null, venue_city: null, venue_country: null })}
        variant="compact"
        href={HREF}
      />,
    );

    expect(screen.getByText(/Venue TBC/)).toBeInTheDocument();
  });

  it("prints the bar's own rounded share as the lead %, so the two never disagree (L6)", () => {
    // Rounded alone 0.456 is 46%; the bar's sum-to-100 split gives home 45.
    const match = makeMatch({ probabilities: { home_win: 0.456, draw: 0.267, away_win: 0.277 } });
    render(<MatchCard match={match} variant="compact" href={HREF} />);
    expect(screen.getByText("45%")).toBeInTheDocument();
    expect(screen.queryByText("46%")).not.toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", expect.stringContaining("Argentina win 45%"));
  });

  it("shows a muted lead percentage when no side clears 60%", () => {
    const match = makeMatch({ probabilities: { home_win: 0.42, draw: 0.3, away_win: 0.28 } });
    render(<MatchCard match={match} variant="compact" href={HREF} />);

    const lead = screen.getByText("42%");
    expect(lead).toHaveClass("text-muted");
    expect(lead).not.toHaveClass("text-lime-deep");
  });

  it("shows the final score and a 'Called it' verdict for a finished match the model got right", () => {
    const match = makeMatch({
      status: "finished",
      score_home: 3,
      score_away: 1,
      // Argentina (home) favoured and won; predicted 2–0, so it's a winner, not exact.
      probabilities: { home_win: 0.65, draw: 0.2, away_win: 0.15 },
    });
    render(<MatchCard match={match} variant="compact" href={HREF} />);

    expect(screen.getByText("3–1")).toBeInTheDocument();
    expect(screen.getByText("Called it")).toBeInTheDocument();
    // The stale pre-match win % is gone — a result never shows a pre-kickoff %.
    expect(screen.queryByText("65%")).not.toBeInTheDocument();
  });

  it("shows the final score and an upset verdict when the favourite lost", () => {
    const match = makeMatch({ status: "finished", score_home: 0, score_away: 2 });
    render(<MatchCard match={match} variant="compact" href={HREF} />);

    expect(screen.getByText("0–2")).toBeInTheDocument();
    expect(screen.getByText(/Upset/)).toHaveClass("text-loss-ink");
  });

  it("promotes the live win probabilities into the bar and leads with the score", () => {
    const liveMatch = makeMatch({
      kickoff_utc: new Date(Date.now() - 20 * 60_000).toISOString(),
      status: "in_play",
      score_home: 1,
      score_away: 0,
      minute: 55,
      period: "second_half",
      probabilities: { home_win: 0.5, draw: 0.3, away_win: 0.2 },
      live_probabilities: { home_win: 0.82, draw: 0.12, away_win: 0.06 },
    });
    render(<MatchCard match={liveMatch} variant="compact" href={HREF} />);

    expect(screen.getByText("1–0")).toBeInTheDocument();
    // The bar reads the in-play odds (82%), not the stale pre-match 50%.
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", expect.stringContaining("82%"));
  });
});

describe("MatchCard clock (H2: cached list HTML hydrating later)", () => {
  // In play 170 minutes after kickoff when the list was rendered; hydrated 30
  // minutes later the browser clock alone would call it stale.
  const KO = "2026-11-08T12:00:00Z";
  const SERVER = new Date("2026-11-08T14:50:00Z");
  const CLIENT = new Date("2026-11-08T15:20:00Z");
  const inPlay = makeMatch({ kickoff_utc: KO, status: "in_play", score_home: 1, score_away: 0, minute: 90, period: "second_half" });

  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = "";
  });

  it("hydrates with its list's server clock without a mismatch, then applies the browser clock", async () => {
    jest.useFakeTimers({ now: SERVER });
    const { html, container, errors } = await hydrateAcrossTime(
      () => (
        <RenderClockContext.Provider value={SERVER}>
          <MatchCard match={inPlay} variant="compact" href={HREF} />
        </RenderClockContext.Provider>
      ),
      SERVER,
      CLIENT,
    );
    expect(html).toContain("90&#x27; est.");
    expect(errors).toEqual([]);
    expect(container).toHaveTextContent("90' est."); // the list's clock still says live
  });

  it("without a list clock, classifies by the feed while hydrating, then by the browser clock", async () => {
    jest.useFakeTimers({ now: SERVER });
    const { errors, container } = await hydrateAcrossTime(
      () => <MatchCard match={inPlay} variant="compact" href={HREF} />,
      SERVER,
      CLIENT,
    );
    expect(errors).toEqual([]);
    // One commit after hydration the browser clock applies the live bound.
    expect(container).toHaveTextContent("Result pending");
  });
});

describe("MatchCard (NRL slots: badge / href / margin)", () => {
  it("badge=\"club\" renders self-hosted club crests", () => {
    const match = makeMatch({ teams: { home: "Broncos", away: "Storm" } });
    const { container } = render(<MatchCard match={match} badge="club" href={null} />);

    expect(container.querySelector('[data-club-logo="Broncos"] img')).toHaveAttribute(
      "src",
      "/clubs/nrl/broncos.svg",
    );
    expect(container.querySelector('[data-club-logo="Storm"] img')).toHaveAttribute(
      "src",
      "/clubs/nrl/storm.svg",
    );
  });

  it("href overrides the football detail link with the NRL match route", () => {
    const match = makeMatch();
    render(<MatchCard match={match} href="/nrl/match/2026/19/3" />);

    expect(screen.getByRole("link")).toHaveAttribute("href", "/nrl/match/2026/19/3");
  });

  it("href={null} drops the link entirely but still shows the team names", () => {
    const match = makeMatch();
    render(<MatchCard match={match} href={null} />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getAllByText("Argentina").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Japan").length).toBeGreaterThanOrEqual(1);
  });

  it("names the outcome the compact lead percentage belongs to", () => {
    // "49%" alone was ambiguous — lead is max(home, draw, away), so the bare
    // number could describe any of the three outcomes.
    const homeLed = makeMatch(); // 65/20/15 → Argentina
    const { rerender } = render(<MatchCard match={homeLed} variant="compact" href={HREF} />);
    expect(screen.getByText("65%")).toBeInTheDocument();
    expect(screen.getAllByText(/Argentina/).length).toBeGreaterThan(1); // names row + lead label

    rerender(
      <MatchCard
        match={makeMatch({ probabilities: { home_win: 0.2, draw: 0.5, away_win: 0.3 } })}
        variant="compact"
        href={HREF}
      />,
    );
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("Draw")).toBeInTheDocument();

    rerender(
      <MatchCard
        match={makeMatch({ probabilities: { home_win: 0.1, draw: 0.2, away_win: 0.7 } })}
        variant="compact"
        href={HREF}
      />,
    );
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.getAllByText(/Japan/).length).toBeGreaterThan(1);
  });

  it("reads the margin chip as the favoured side, not a signed number", () => {
    // "margin -5.5" assumed the reader knows home-minus-away; the chip now
    // names who is favoured and by how much.
    const positive = makeMatch();
    const { rerender } = render(
      <MatchCard match={positive} variant="compact" margin={5.5} href={HREF} />,
    );
    expect(screen.getByText("Argentina by 5.5")).toBeInTheDocument();

    rerender(<MatchCard match={positive} variant="compact" margin={-5.5} href={HREF} />);
    expect(screen.getByText("Japan by 5.5")).toBeInTheDocument();

    rerender(<MatchCard match={positive} variant="compact" margin={0} href={HREF} />);
    expect(screen.getByText("dead level")).toBeInTheDocument();
  });
});

describe("MatchCard compact row shows BOTH crests", () => {
  // The compact row names both sides in its title but rendered only the home
  // badge, so every away team was unidentifiable at a glance — the one thing a
  // fixture list is scanned for. The `full` variant already showed both (one
  // per stacked team row); only this dense variant was short.
  it("renders the away club crest alongside the home one", () => {
    const match = makeMatch({ teams: { home: "Broncos", away: "Storm" } });
    const { container } = render(
      <MatchCard match={match} variant="compact" badge="club" href={null} />,
    );

    expect(container.querySelector('[data-club-logo="Broncos"] img')).toHaveAttribute(
      "src",
      "/clubs/nrl/broncos.svg",
    );
    expect(container.querySelector('[data-club-logo="Storm"] img')).toHaveAttribute(
      "src",
      "/clubs/nrl/storm.svg",
    );
  });

  it("renders the away flag alongside the home one", () => {
    // National teams route through Flag, which emits a bare decorative <img>
    // with no data hook — so count images rather than club-logo attributes.
    const match = makeMatch({ teams: { home: "Argentina", away: "Japan" } });
    const { container } = render(<MatchCard match={match} variant="compact" href={HREF} />);

    const flags = container.querySelectorAll('img[alt=""]');
    expect(flags).toHaveLength(2);
    expect([...flags].map((f) => f.getAttribute("src"))).toEqual([
      expect.stringContaining("ar"),
      expect.stringContaining("jp"),
    ]);
  });

  it("keeps both crests decorative so the row reads once to a screen reader", () => {
    // The team names are already in the title. If the badges announced too, a
    // screen reader would hear "Argentina Argentina Japan Japan".
    const match = makeMatch({ teams: { home: "Argentina", away: "Japan" } });
    const { container } = render(<MatchCard match={match} variant="compact" href={HREF} />);

    for (const el of container.querySelectorAll("[data-club-logo], [data-team-badge]")) {
      expect(el.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });
});
