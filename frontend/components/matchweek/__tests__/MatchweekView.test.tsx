/** The matchweek home (prototype `pageMatches`). The reveal rule is the
 *  point of most of these: an open fixture shows "Pick score" and no model
 *  number -- in the server HTML, on first paint, and after the picks load --
 *  until the viewer has locked a pick; then "You 2–1 / Model 2–0". Finished
 *  matches show the model's verdict and scoreline. */
import { render, screen, waitFor, within } from "@testing-library/react";
import { MatchweekView, type MatchweekViewProps } from "@/components/matchweek/MatchweekView";
import { getMatchSummary } from "@/lib/api";
import { getMyLeagueTips } from "@/lib/leagueTips";
import { resetRevealStore } from "@/lib/useModelReveal";
import { withoutModel } from "@/lib/matchweeks";
import type { LeagueTipsMineResponse, MatchSummary } from "@/lib/types";

jest.mock("@/components/rail/YouAndModelCard", () => ({ YouAndModelCard: () => <div>You and the model card</div> }));
jest.mock("@/components/rail/MiniTableCard", () => ({ MiniTableCard: () => <div>Mini table card</div> }));
jest.mock("@/lib/api");
jest.mock("@/lib/leagueTips");
jest.mock("@/lib/nrlTips");
jest.mock("@/lib/session", () => {
  const actual = jest.requireActual("@/lib/session");
  return { ...actual, getOrCreateDeviceId: jest.fn(() => "device-1") };
});
const mockMine = getMyLeagueTips as jest.MockedFunction<typeof getMyLeagueTips>;
const mockSummary = getMatchSummary as jest.MockedFunction<typeof getMatchSummary>;

const FUTURE = new Date(Date.now() + 2 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 5 * 86_400_000).toISOString();

function m(id: number, over: Partial<MatchSummary> = {}): MatchSummary {
  return {
    match_id: id, stage: "group", group: "Premier League", kickoff_utc: FUTURE, venue: `Ground ${id}`,
    venue_city: null, venue_country: null, is_neutral: false, status: "scheduled", score_home: null,
    score_away: null, minute: null, period: null, injury_time: null, penalty_home: null, penalty_away: null,
    goal_events: [], teams: { home: `Home ${id}`, away: `Away ${id}` }, predicted_winner: null,
    probabilities: null, predicted_score: { home: 2, away: 0, probability: 0.1 }, confidence: null,
    competition: "epl", matchweek: 11, ...over,
  };
}

function props(matches: MatchSummary[], over: Partial<MatchweekViewProps> = {}): MatchweekViewProps {
  return {
    competition: "epl",
    eyebrow: "Premier League · 2026–27",
    round: { key: "11", title: "Matchweek 11", matches },
    prev: { title: "Matchweek 10", href: "/football/epl?mw=10" },
    next: { title: "Matchweek 12", href: "/football/epl?mw=12" },
    fixturesHref: "/football/epl",
    resultsHref: "/football/epl?mw=10",
    renderedAt: new Date().toISOString(),
    ...over,
  };
}

const week = (matches: LeagueTipsMineResponse["matches"]): LeagueTipsMineResponse => ({
  league: "epl", matchweek: 11, handle: null, matches, disclaimer: "",
});
const yours = (id: number, h: number, a: number): LeagueTipsMineResponse["matches"][number] => ({
  id, home: "", away: "", kickoff_utc: FUTURE, status: "scheduled", score_home: null, score_away: null,
  model: null,
  your_prediction: { predicted_home: h, predicted_away: a, points: null, exact: null, graded_at: null, updated_at: null },
});

beforeEach(() => {
  resetRevealStore();
  window.localStorage.clear();
  window.localStorage.setItem("pp:timezone", JSON.stringify({ tz: "UTC", confirmed: true }));
  mockMine.mockReset();
  mockSummary.mockReset();
  mockMine.mockResolvedValue(week([]));
});

describe("open matchweek", () => {
  const open = [m(1), m(2), m(3)].map(withoutModel);

  it("renders the head, arrows, the Fixtures/Results control and the rail", () => {
    render(<MatchweekView {...props(open)} />);
    expect(screen.getByRole("heading", { level: 1, name: "Matchweek 11" })).toBeInTheDocument();
    expect(screen.getByText("Premier League · 2026–27")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Matchweek 10" })).toHaveAttribute("href", "/football/epl?mw=10");
    expect(screen.getByRole("link", { name: "Matchweek 12" })).toHaveAttribute("href", "/football/epl?mw=12");
    const seg = screen.getByRole("group", { name: "Show" });
    expect(within(seg).getByRole("link", { name: "Fixtures" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText(/Three matches/)).toBeInTheDocument();
    expect(screen.getByText(/your local time/)).toBeInTheDocument();
    expect(screen.getByText("You and the model card")).toBeInTheDocument();
    expect(screen.getByText("Mini table card")).toBeInTheDocument();
  });

  it("disables an arrow at the end of the season", () => {
    render(<MatchweekView {...props(open, { next: null })} />);
    expect(screen.queryByRole("link", { name: /Matchweek 12/ })).toBeNull();
    expect(screen.getByRole("button", { name: /No later matchweek/ })).toBeDisabled();
  });

  it("offers Pick score on every unpicked open fixture and shows no model number", async () => {
    const { container } = render(<MatchweekView {...props(open)} />);
    await waitFor(() => expect(screen.getByText("0 of 3 picked")).toBeInTheDocument());
    const picks = screen.getAllByRole("link", { name: /^Pick the score for / });
    expect(picks).toHaveLength(3);
    expect(picks[0]).toHaveAttribute("href", "/football/epl/match/1#pick");
    expect(container).not.toHaveTextContent("2–0");
    expect(container).not.toHaveTextContent(/Model/);
    expect(screen.getByRole("link", { name: "Start picking" })).toHaveAttribute("href", "/football/epl/match/1#pick");
  });

  it("does not show the model's score even if an open fixture still carries it", async () => {
    const { container } = render(<MatchweekView {...props([m(1), m(2)])} />);
    await waitFor(() => expect(mockMine).toHaveBeenCalled());
    expect(container).not.toHaveTextContent("2–0");
  });

  it("keeps open fixtures' model numbers out of the server HTML", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    if (!g.TextEncoder) g.TextEncoder = jest.requireActual("node:util").TextEncoder;
    const server = jest.requireActual("react-dom/server.node") as typeof import("react-dom/server");
    const html = server.renderToString(<MatchweekView {...props([m(1), m(2)])} />);
    expect(html).not.toContain("2–0");
    expect(html).toContain("Pick score");
  });

  it("shows You and Model for a locked pick, and counts it in the foot", async () => {
    mockMine.mockResolvedValue(week([yours(2, 2, 1)]));
    mockSummary.mockResolvedValue({ ...m(2), predicted_score: { home: 0, away: 2, probability: 0.1 } });
    render(<MatchweekView {...props(open)} />);
    expect(await screen.findByText("2–1")).toBeInTheDocument();
    expect(await screen.findByText("0–2")).toBeInTheDocument();
    expect(mockSummary).toHaveBeenCalledWith(2, "epl");
    expect(mockSummary).toHaveBeenCalledTimes(1);
    expect(screen.getByText("1 of 3 picked")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pick the other 2" })).toHaveAttribute("href", "/football/epl/match/1#pick");
    expect(screen.getAllByRole("link", { name: /^Pick the score for / })).toHaveLength(2);
  });

  it("sends a viewer who picked everything to their picks", async () => {
    mockMine.mockResolvedValue(week([yours(1, 1, 0), yours(2, 1, 1), yours(3, 0, 0)]));
    mockSummary.mockResolvedValue(m(9));
    render(<MatchweekView {...props(open)} />);
    expect(await screen.findByText("All 3 picked")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See my picks" })).toHaveAttribute("href", "/play?competition=epl");
  });
});

describe("finished matchweek", () => {
  const done = [
    m(1, { status: "finished", score_home: 2, score_away: 0, kickoff_utc: PAST }),
    m(2, { status: "finished", score_home: 3, score_away: 1, kickoff_utc: PAST }),
    m(3, { status: "finished", score_home: 0, score_away: 1, kickoff_utc: PAST }),
  ];

  it("shows scores, the model's verdicts and its points for the week", () => {
    render(<MatchweekView {...props(done)} />);
    expect(screen.getByText("Exact score")).toBeInTheDocument();
    expect(screen.getByText("Right result")).toBeInTheDocument();
    expect(screen.getByText("Missed")).toBeInTheDocument();
    expect(screen.getAllByText("2–0").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("The model scored 7 points this matchweek")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Show" })).getByRole("link", { name: "Results" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("link", { name: /Pick the score/ })).toBeNull();
  });
});

describe("other competitions", () => {
  it("Champions League: no pick game, so the model's call shows and there is no Pick score", () => {
    const ucl = [m(1, { competition: "ucl", matchweek: 5 })];
    render(<MatchweekView {...props(ucl, { competition: "ucl", eyebrow: "UEFA Champions League · 2026–27", round: { key: "5", title: "Matchday 5", matches: ucl } })} />);
    expect(screen.getByText("2–0")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Pick the score/ })).toBeNull();
    expect(screen.queryByText("You and the model card")).toBeNull();
    expect(screen.getByText(/picks are not open yet/)).toBeInTheDocument();
  });

  it("World Cup archive: flags, results, the champion and links to groups and bracket", () => {
    const final = [
      m(1, { competition: "wc26", stage: "final", matchweek: null, status: "finished", score_home: 1, score_away: 0, kickoff_utc: PAST, teams: { home: "Spain", away: "Argentina" } }),
    ];
    render(
      <MatchweekView
        {...props(final, {
          competition: "wc26", eyebrow: "World Cup 2026 · Archive", round: { key: "final", title: "Final", matches: final },
          next: null, fixturesHref: null, resultsHref: "/football/wc26", champion: "Spain",
        })}
      />,
    );
    expect(screen.getByText("Champions")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Groups" })).toHaveAttribute("href", "/football/wc26/groups");
    expect(screen.getAllByRole("link", { name: /bracket/i })[0]).toHaveAttribute("href", "/football/wc26/bracket");
    expect(screen.queryByRole("group", { name: "Show" })).toBeNull();
    expect(screen.getByText("Right result")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Pick the score/ })).toBeNull();
  });
});
