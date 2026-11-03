/** Play hub page -- server component (SSR) output. The test checks the server
 *  wiring on top of the shell: it renders both sport group headings, surfaces
 *  the /brackets entry with the predicted champion (top win_title team) and
 *  mounts the reused league tips picker (p5-s2), and composes the reused NRL
 *  beat-the-AI loop (p5-s3) seeded from getNrlTipsheetServer -- the play round
 *  mounts with that season/round, degrading to an honest empty state when the
 *  fetch returns null / rejects. Each section's own leaderboard is suppressed
 *  and hoisted into one unified, competition-filtered board (p5-s4). The
 *  bracket entry gates
 *  on the active tournament's has_brackets, exactly as app/brackets does, so a
 *  league-format tournament renders the league tips only (honest degrade). Both
 *  groups' leaf components are stubbed the same way components/{leagueTips,nrl}/
 *  *.test.tsx do -- this test is about the composition, not each picker's own
 *  fetch machinery. */
import { render, screen } from "@testing-library/react";
import PlayPage from "./page";
import {
  getKnockoutOddsServer,
  getNrlTipsheetServer,
} from "@/lib/api";
import type { NrlTipsheet, TournamentOdds } from "@/lib/types";

jest.mock("@/lib/api");
const mockTipsheet = getNrlTipsheetServer as jest.MockedFunction<typeof getNrlTipsheetServer>;
const mockKnockoutOdds = getKnockoutOddsServer as jest.MockedFunction<typeof getKnockoutOddsServer>;

// The Football group renders the real LeagueTipsPlaySection, whose leaf
// components each fetch on mount -- stub them (mirrors
// components/leagueTips/LeagueTipsPlaySection.test.tsx) so this test exercises
// the composition, not their client fetch/localStorage paths.
jest.mock("@/components/leagueTips/LeagueTipsPicker", () => ({
  LeagueTipsPicker: ({ league }: { league: string; onMatchweekChange?: (mw: number) => void }) => (
    <div data-testid={`picker-${league}`}>{league}</div>
  ),
}));
jest.mock("@/components/leagueTips/LeagueYouVsAi", () => ({
  LeagueYouVsAi: ({ league }: { league: string }) => <div data-testid="you-vs-ai">{league}</div>,
}));
jest.mock("@/components/leagueTips/LeagueTipsLeaderboard", () => ({
  LeagueTipsLeaderboard: ({ league, matchweek }: { league: string; matchweek: number }) => (
    <div data-testid="leaderboard">{`${league}-${matchweek}`}</div>
  ),
}));

// The NRL group renders the real NrlTipsPlaySection, whose leaf components each
// fetch on mount (device id, auth context, network) -- stub them (mirrors
// components/nrl/*.test.tsx) so this test exercises the composition and that
// the play round + leaderboard get the seeded season/round, not their fetch
// paths.
jest.mock("@/components/nrl/PlayRound", () => ({
  PlayRound: ({ season, round }: { season: number; round: number }) => (
    <div data-testid="nrl-play-round">{`${season}-${round}`}</div>
  ),
}));
jest.mock("@/components/nrl/YouVsAi", () => ({
  YouVsAi: () => <div data-testid="nrl-you-vs-ai" />,
}));
jest.mock("@/components/nrl/NrlTipsLeaderboard", () => ({
  NrlTipsLeaderboard: ({ season, round }: { season: number; round: number }) => (
    <div data-testid="nrl-leaderboard">{`${season}-${round}`}</div>
  ),
}));

const tipsheet: NrlTipsheet = {
  season: 2026,
  round: 2,
  matches: [],
  record: {
    evaluated_matches: 0, winner_accuracy: null, winner_accuracy_ci95: null,
    avg_log_loss: null, avg_brier: null, best_streak: 0, last_updated: null,
  },
  worst_miss: null,
  disclaimer: "For analytics and entertainment only. Not betting advice.",
};

const odd = (team_id: number, team: string, win_title: number | null): TournamentOdds => ({
  team_id, team, make_knockout: null, reach_r16: null, reach_qf: null, reach_sf: null,
  reach_final: null, win_title,
});
// Brazil leads on win_title -> the predicted champion the card should print.
const odds: TournamentOdds[] = [odd(1, "France", 0.15), odd(2, "Brazil", 0.18)];

const playPage = (competition: string) =>
  PlayPage({ searchParams: Promise.resolve({ competition }) });

beforeEach(() => {
  mockTipsheet.mockResolvedValue(tipsheet);
  mockKnockoutOdds.mockResolvedValue(odds);
});
afterEach(() => jest.resetAllMocks());

it("renders the prototype slate grouped by competition", async () => {
  render(await PlayPage({}));

  expect(screen.getByRole("heading", { level: 1, name: "The slate" })).toBeInTheDocument();
  for (const name of [
    "Premier League",
    "La Liga",
    "Bundesliga",
    "UEFA Champions League",
    "World Cup 2026",
    "NRL",
  ]) {
    expect(screen.getByRole("heading", { name })).toBeInTheDocument();
  }
  expect(document.querySelectorAll("[data-competition-logo]")).toHaveLength(10);
});

it("mounts only the selected competition's interactive section", async () => {
  render(await PlayPage({}));

  expect(screen.getByTestId("picker-epl")).toBeInTheDocument();
  expect(screen.queryByTestId("picker-laliga")).toBeNull();
  expect(screen.queryByTestId("picker-bundesliga")).toBeNull();
  expect(screen.queryByTestId("nrl-play-round")).toBeNull();
  expect(screen.queryByRole("link", { name: /Projected knockout bracket/i })).toBeNull();
  expect(screen.queryByRole("link", { name: /View Champions League fixtures/i })).toBeNull();
});

it("seeds the NRL group with the current round when the tipsheet loads", async () => {
  render(await playPage("nrl"));

  expect(mockTipsheet).toHaveBeenCalledWith();
  expect(screen.getByText("Round 2 · 2026")).toBeInTheDocument();
});

it("composes the NRL beat-the-AI loop, seeding the play round with the current round", async () => {
  render(await playPage("nrl"));

  // The reused NrlTipsPlaySection mounts the play round seeded with the
  // server-fetched season/round (2026 round 2). Its weekly leaderboard is
  // suppressed here (showLeaderboard=false) -- it's hoisted into the unified
  // board below (see the unified-leaderboard test).
  expect(screen.getByTestId("nrl-play-round")).toHaveTextContent("2026-2");
  expect(screen.getByTestId("nrl-leaderboard")).toHaveTextContent("2026-2");
  expect(screen.queryByText(/NRL tips aren't available/)).not.toBeInTheDocument();
});

it("hoists the NRL board into the unified leaderboard, seeded from the current round", async () => {
  render(await playPage("nrl"));

  // The query-selected NRL board mounts directly, seeded with the same
  // server-fetched season/round. Other filter links navigate through the URL
  // so their own prerequisites resolve on the next server render.
  expect(screen.getByRole("link", { name: "NRL" })).toHaveAttribute(
    "href", "/play?competition=nrl",
  );
  expect(screen.getByTestId("nrl-leaderboard")).toHaveTextContent("2026-2");
});

it("degrades to the empty state (no round line, no crash) when the tipsheet is null", async () => {
  mockTipsheet.mockResolvedValue(null);
  render(await playPage("nrl"));

  expect(screen.getByRole("heading", { name: "Premier League" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "NRL" })).toBeInTheDocument();
  expect(screen.queryByText(/^Round \d/)).not.toBeInTheDocument();
  // No fabricated season/round: the loop is replaced by the honest empty state.
  expect(screen.queryByTestId("nrl-play-round")).not.toBeInTheDocument();
  expect(screen.getByText("NRL tips aren't available right now.")).toBeInTheDocument();
});

it("degrades to the empty state (no crash) when the NRL tipsheet fetch rejects", async () => {
  mockTipsheet.mockRejectedValue(new Error("upstream down"));
  render(await playPage("nrl"));

  expect(screen.getByRole("heading", { name: "Premier League" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "NRL" })).toBeInTheDocument();
  expect(screen.queryByTestId("nrl-play-round")).not.toBeInTheDocument();
  expect(screen.getByText("NRL tips aren't available right now.")).toBeInTheDocument();
});

it("shows the World Cup bracket card linking to /football/wc26/bracket with the predicted champion", async () => {
  render(await playPage("wc26"));

  const bracketLink = screen.getByRole("link", { name: /Projected knockout bracket/i });
  expect(bracketLink).toHaveAttribute("href", "/football/wc26/bracket");
  expect(bracketLink).toHaveTextContent("Brazil");
  expect(bracketLink).toHaveTextContent("18%");
});

it("does not leave the leaderboard loading when the World Cup bracket is selected", async () => {
  render(await playPage("wc26"));

  expect(screen.getByText("World Cup 2026 has no weekly leaderboard.")).toBeInTheDocument();
  expect(screen.queryByRole("status", { name: "Loading leaderboard…" })).not.toBeInTheDocument();
  expect(screen.queryByTestId("leaderboard")).not.toBeInTheDocument();
});

it("degrades the bracket card to a plain link when the knockout odds are unavailable", async () => {
  mockKnockoutOdds.mockResolvedValue(null);
  render(await playPage("wc26"));

  const bracketLink = screen.getByRole("link", { name: /Projected knockout bracket/i });
  expect(bracketLink).toHaveAttribute("href", "/football/wc26/bracket");
  expect(bracketLink).not.toHaveTextContent("Predicted champion");
});

it("mounts the requested league picker and keeps the other leagues closed", async () => {
  render(await playPage("laliga"));

  expect(screen.getByTestId("picker-laliga")).toHaveTextContent("laliga");
  expect(screen.queryByTestId("picker-epl")).not.toBeInTheDocument();
  expect(screen.queryByTestId("picker-bundesliga")).not.toBeInTheDocument();
  expect(screen.queryByTestId("picker-ucl")).not.toBeInTheDocument();
  expect(mockTipsheet).not.toHaveBeenCalled();
  expect(mockKnockoutOdds).not.toHaveBeenCalled();
});
