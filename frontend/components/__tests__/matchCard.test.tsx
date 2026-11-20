/** MatchCard (direction G): the shared fixture card for lists on other pages
 *  (team pages, NRL rounds, timelines).
 *
 *  Reveal rule (lib/reveal.ts): on an OPEN fixture the model's scoreline,
 *  chances and margin stay hidden until the viewer has locked a pick; a
 *  finished or kicked-off match, or a competition with no pick game, shows
 *  the model's call. An unknown competition fails closed.
 *
 *  Honesty rules kept from the previous card: "Full time" only when the feed
 *  says finished (a stranded in_play reads "Result pending", no verdict); an
 *  estimated live minute says so; the link comes from the caller; nothing
 *  interactive inside the link; crests decorative next to printed names. */
import { render, screen, waitFor, within } from "@testing-library/react";
import { MatchCard } from "@/components/MatchCard";
import { RenderClockContext } from "@/components/match/clock";
import { hydrateAcrossTime } from "@/components/match/hydrate.testutil";
import { getMyLeagueTips } from "@/lib/leagueTips";
import { getOrCreateDeviceId } from "@/lib/session";
import { resetRevealStore } from "@/lib/useModelReveal";
import type { LeagueTipsMineResponse, MatchSummary } from "@/lib/types";

jest.mock("@/lib/leagueTips");
jest.mock("@/lib/nrlTips");
jest.mock("@/lib/session", () => {
  const actual = jest.requireActual("@/lib/session");
  return { ...actual, getOrCreateDeviceId: jest.fn(() => "device-1") };
});
const mockMine = getMyLeagueTips as jest.MockedFunction<typeof getMyLeagueTips>;

const HREF = "/football/wc26/match/11";
const EPL_HREF = "/football/epl/match/11";

function makeMatch(overrides: Partial<MatchSummary> = {}): MatchSummary {
  return {
    match_id: 11,
    stage: "group",
    group: "Group B",
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

function mine(matches: LeagueTipsMineResponse["matches"]): LeagueTipsMineResponse {
  return { league: "epl", matchweek: 11, handle: null, matches, disclaimer: "" };
}

beforeEach(() => {
  resetRevealStore();
  window.localStorage.clear();
  mockMine.mockReset();
});

describe("MatchCard reveal rule", () => {
  it("hides the model's score and chances on an open fixture with no pick", async () => {
    mockMine.mockResolvedValue(mine([]));
    const { container } = render(
      <MatchCard match={makeMatch({ competition: "epl", matchweek: 11 })} href={EPL_HREF} />,
    );
    await waitFor(() => expect(mockMine).toHaveBeenCalled());
    expect(container).not.toHaveTextContent("2–0");
    expect(container).not.toHaveTextContent(/%/);
    expect(screen.getByText(/appears once you lock yours/)).toBeInTheDocument();
  });

  it("never puts an open fixture's model call in the server HTML", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    if (!g.TextEncoder) g.TextEncoder = jest.requireActual("node:util").TextEncoder;
    const server = jest.requireActual("react-dom/server.node") as typeof import("react-dom/server");
    const html = server.renderToString(
      <MatchCard match={makeMatch({ competition: "epl", matchweek: 11 })} href={EPL_HREF} />,
    );
    expect(html).not.toContain("2–0");
    expect(html).not.toContain("65%");
  });

  it("shows You and Model once the viewer has locked a pick", async () => {
    mockMine.mockResolvedValue(
      mine([
        {
          id: 11, home: "Argentina", away: "Japan", kickoff_utc: null, status: "scheduled",
          score_home: null, score_away: null, model: null,
          your_prediction: { predicted_home: 1, predicted_away: 1, points: null, exact: null, graded_at: null, updated_at: null },
        },
      ]),
    );
    render(<MatchCard match={makeMatch({ competition: "epl", matchweek: 11 })} href={EPL_HREF} />);
    expect(await screen.findByText("1–1")).toBeInTheDocument();
    expect(screen.getByText("2–0")).toBeInTheDocument();
  });

  it("fails closed for an unknown competition (no href, no competition field)", () => {
    const { container } = render(<MatchCard match={makeMatch()} href={null} />);
    expect(container).not.toHaveTextContent("2–0");
  });

  it("shows the model's call where there is no pick game (Champions League)", () => {
    render(<MatchCard match={makeMatch({ competition: "ucl" })} href="/football/ucl/match/11" />);
    expect(screen.getByText("2–0")).toBeInTheDocument();
  });

  it("shows the model's call and a verdict chip once the match is finished", () => {
    render(<MatchCard match={makeMatch({ status: "finished", score_home: 3, score_away: 1 })} href={HREF} />);
    expect(screen.getByText("Full time")).toBeInTheDocument();
    expect(screen.getByText("Right result")).toBeInTheDocument();
    expect(screen.getByText("2–0")).toBeInTheDocument();
  });

  it("marks an exact score and a miss", () => {
    const { rerender } = render(
      <MatchCard match={makeMatch({ status: "finished", score_home: 2, score_away: 0 })} href={HREF} />,
    );
    expect(screen.getByText("Exact score")).toBeInTheDocument();
    rerender(<MatchCard match={makeMatch({ status: "finished", score_home: 0, score_away: 2 })} href={HREF} />);
    expect(screen.getByText("Missed")).toBeInTheDocument();
  });

  it("reads the NRL margin as the favoured side, only once revealed", () => {
    const live = makeMatch({
      kickoff_utc: new Date(Date.now() - 20 * 60_000).toISOString(),
      status: "in_play", score_home: 6, score_away: 0, minute: 20, period: "first_half",
      predicted_score: null,
    });
    render(<MatchCard match={live} badge="club" margin={-5.5} href="/nrl/match/2026/19/3" />);
    expect(screen.getByText("Japan by 5.5")).toBeInTheDocument();
  });

  it("keeps the margin hidden on an open NRL fixture", () => {
    const { container } = render(
      <MatchCard match={makeMatch({ predicted_score: null })} badge="club" margin={5.5} href="/nrl/match/2026/19/3" />,
    );
    expect(container).not.toHaveTextContent("by 5.5");
  });
});

describe("MatchCard (full variant, default)", () => {
  it("renders both team names and links to the caller's href", () => {
    render(<MatchCard match={makeMatch()} href={HREF} />);
    expect(screen.getByText("Argentina")).toBeInTheDocument();
    expect(screen.getByText("Japan")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", HREF);
  });

  it("keeps the interactive favourite star out of the card link", () => {
    window.localStorage.setItem("pp:favorites", JSON.stringify(["Argentina"]));
    render(<MatchCard match={makeMatch()} href={HREF} />);
    const link = screen.getByRole("link");
    expect(within(link).queryByRole("button")).toBeNull();
    expect(within(link).getByText("(favourite team)")).toHaveClass("sr-only");
  });

  it("marks a live card and says the live minute is an estimate", () => {
    const liveMatch = makeMatch({
      kickoff_utc: new Date(Date.now() - 30 * 60_000).toISOString(),
      status: "in_play", score_home: 1, score_away: 1, minute: 34, period: "first_half",
    });
    render(<MatchCard match={liveMatch} href={HREF} />);
    expect(screen.getByRole("link")).toHaveAttribute("data-live", "true");
    expect(screen.getByText("34' est.")).toBeInTheDocument();
    expect(screen.getByLabelText("Live, 34' (estimated)")).toBeInTheDocument();
  });

  it("says 'Result pending' -- not Full time, no verdict -- for an in_play row stranded past the live window", () => {
    const stranded = makeMatch({
      kickoff_utc: new Date(Date.now() - 8 * 60 * 60_000).toISOString(),
      status: "in_play", score_home: 2, score_away: 0, minute: 90, period: "second_half",
    });
    render(<MatchCard match={stranded} href={HREF} />);
    expect(screen.getByText("Result pending")).toBeInTheDocument();
    expect(screen.queryByText("Full time")).not.toBeInTheDocument();
    expect(screen.queryByText(/est\./)).not.toBeInTheDocument();
    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Exact score|Right result|Missed/)).not.toBeInTheDocument();
  });

  it("labels a postponed fixture without showing its stale kickoff", () => {
    render(
      <MatchCard match={makeMatch({ status: "postponed", kickoff_utc: "2026-08-21T19:00:00Z" })} tz="UTC" href={HREF} />,
    );
    expect(screen.getByText("Postponed")).toBeInTheDocument();
    expect(screen.queryByText("7:00 PM")).not.toBeInTheDocument();
  });

  it.each(["cancelled", "suspended"] as const)("labels %s", (status) => {
    render(<MatchCard match={makeMatch({ status })} tz="UTC" href={HREF} />);
    expect(screen.getByText(status === "cancelled" ? "Cancelled" : "Suspended")).toBeInTheDocument();
  });

  it("uses only direction-G styling: no glass, glow or lime", () => {
    const { container } = render(<MatchCard match={makeMatch()} href={HREF} />);
    expect(container.innerHTML).not.toMatch(/glass|glow|lime/);
  });
});

describe('MatchCard (variant="compact")', () => {
  it("links to the match page", () => {
    render(<MatchCard match={makeMatch()} variant="compact" href={HREF} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", HREF);
  });

  it("reads 'Result pending' for a scheduled row whose kickoff is long past", () => {
    const overdue = makeMatch({ kickoff_utc: new Date(Date.now() - 5 * 60 * 60_000).toISOString() });
    render(<MatchCard match={overdue} variant="compact" href={HREF} tz="UTC" />);
    expect(screen.getByText(/Result pending/)).toBeInTheDocument();
  });

  it("logs a missing href once and falls back to the legacy lookup path", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    render(<MatchCard match={makeMatch()} variant="compact" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/match/11");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("MatchCard rendered without an href"));
    warn.mockRestore();
  });

  it("shows Venue TBC when the provider has not confirmed a stadium", () => {
    render(
      <MatchCard match={makeMatch({ venue: null, venue_city: null, venue_country: null })} variant="compact" href={HREF} />,
    );
    expect(screen.getByText(/Venue TBC/)).toBeInTheDocument();
  });

  it("shows the final score and the verdict for a finished match", () => {
    render(
      <MatchCard match={makeMatch({ status: "finished", score_home: 3, score_away: 1 })} variant="compact" href={HREF} />,
    );
    expect(screen.getByText("3–1")).toBeInTheDocument();
    expect(screen.getByText("Right result")).toBeInTheDocument();
    expect(screen.queryByText("65%")).not.toBeInTheDocument();
  });

  it("never shows a lead percentage on an open fixture", () => {
    const { container } = render(<MatchCard match={makeMatch()} variant="compact" href={HREF} />);
    expect(container).not.toHaveTextContent(/\d%/);
  });
});

describe("MatchCard clock (H2: cached list HTML hydrating later)", () => {
  const KO = "2026-11-08T12:00:00Z";
  const SERVER = new Date("2026-11-08T14:50:00Z");
  const CLIENT = new Date("2026-11-08T15:20:00Z");
  const inPlay = makeMatch({ kickoff_utc: KO, status: "in_play", score_home: 1, score_away: 0, minute: 90, period: "second_half" });

  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = "";
  });

  it("hydrates with its list's server clock without a mismatch", async () => {
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
    expect(container).toHaveTextContent("90' est.");
  });

  it("without a list clock, classifies by the feed while hydrating, then by the browser clock", async () => {
    jest.useFakeTimers({ now: SERVER });
    const { errors, container } = await hydrateAcrossTime(
      () => <MatchCard match={inPlay} variant="compact" href={HREF} />,
      SERVER,
      CLIENT,
    );
    expect(errors).toEqual([]);
    expect(container).toHaveTextContent("Result pending");
  });
});

describe("MatchCard crests", () => {
  it('badge="club" renders self-hosted club crests', () => {
    const { container } = render(
      <MatchCard match={makeMatch({ teams: { home: "Broncos", away: "Storm" } })} badge="club" href={null} />,
    );
    expect(container.querySelector('[data-club-logo="Broncos"] img')).toHaveAttribute("src", "/clubs/nrl/broncos.svg");
    expect(container.querySelector('[data-club-logo="Storm"] img')).toHaveAttribute("src", "/clubs/nrl/storm.svg");
  });

  it("href={null} drops the link entirely but still shows the team names", () => {
    render(<MatchCard match={makeMatch()} href={null} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Argentina")).toBeInTheDocument();
  });

  it("compact row shows BOTH crests side by side, with no ring or plate", () => {
    const { container } = render(
      <MatchCard match={makeMatch({ teams: { home: "Broncos", away: "Storm" } })} variant="compact" badge="club" href={null} />,
    );
    expect(container.querySelector('[data-club-logo="Broncos"] img')).toHaveAttribute("src", "/clubs/nrl/broncos.svg");
    expect(container.querySelector('[data-club-logo="Storm"] img')).toHaveAttribute("src", "/clubs/nrl/storm.svg");
    expect(container.innerHTML).not.toMatch(/ring-2|-ml-1\.5/);
  });

  it("renders both flags, decorative, so the names read once to a screen reader", () => {
    const { container } = render(<MatchCard match={makeMatch()} variant="compact" href={HREF} />);
    const flags = container.querySelectorAll('img[alt=""]');
    expect(flags).toHaveLength(2);
    expect([...flags].map((f) => f.getAttribute("src"))).toEqual([
      expect.stringContaining("ar"),
      expect.stringContaining("jp"),
    ]);
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });
});
