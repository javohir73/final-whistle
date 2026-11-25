/** Global search: built only from data the app already serves (team lists,
 *  the current competition's upcoming fixtures, the NRL draw, a static page
 *  list). Results are links, grouped; the dialog traps focus and Escape
 *  closes it and hands focus back to the magnifier. */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  SiteSearch,
  searchGroups,
  goToItems,
  pageItems,
  nearestMatches,
  contextFor,
  type SearchItem,
} from "@/components/SiteSearch";
import * as api from "@/lib/api";

jest.mock("@/lib/api");
const mockApi = api as jest.Mocked<typeof api>;

jest.mock("next/navigation", () => ({ usePathname: () => "/football/epl" }));

beforeEach(() => {
  mockApi.getTeams.mockImplementation(async (comp) =>
    comp === "epl"
      ? ([
          { id: 1, name: "Arsenal" },
          { id: 2, name: "Newcastle" },
        ] as never)
      : ([] as never),
  );
  mockApi.getUpcomingMatches.mockResolvedValue([
    // The list now carries status (it holds results as well as fixtures).
    { match_id: 205, kickoff_utc: "2099-11-21T17:30:00Z", status: "scheduled", matchweek: 11, teams: { home: "Newcastle", away: "Arsenal" } },
  ] as never);
  mockApi.getNrlMatches.mockResolvedValue({
    season: 2026,
    disclaimer: "",
    rounds: [{ round: 1, matches: [{ id: 9, match_no: 1, home: "Roosters", away: "Knights", home_team_id: 7, away_team_id: 8, kickoff_utc: "2026-03-01T08:00:00Z" }] }],
  } as never);
});

const open = () => {
  render(<SiteSearch competition="epl" />);
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  return screen.getByRole("dialog", { name: "Search" });
};

it("opens with focus in the field and a 'Go to' list of real pages", () => {
  const dialog = open();
  expect(screen.getByRole("searchbox", { name: "Search clubs, matches and pages" })).toHaveFocus();
  const goTo = within(dialog).getByRole("region", { name: "Go to" });
  expect(within(goTo).getByRole("link", { name: /^Matches/ })).toHaveAttribute("href", "/football/epl");
  expect(within(goTo).getByRole("link", { name: /^Table/ })).toHaveAttribute("href", "/football/epl/standings");
});

it("finds clubs (with crests), matches and pages for 'ars'", async () => {
  const dialog = open();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "ars" } });
  const clubs = await within(dialog).findByRole("region", { name: "Clubs" });
  const arsenal = within(clubs).getByRole("link", { name: /Arsenal/ });
  expect(arsenal).toHaveAttribute("href", "/football/epl/team/1");
  expect(arsenal).toHaveTextContent("Premier League");
  expect(arsenal.querySelector("img")).toHaveAttribute("alt", "");
  const matches = await within(dialog).findByRole("region", { name: "Matches" });
  expect(within(matches).getByRole("link", { name: /Newcastle v Arsenal/ })).toHaveAttribute(
    "href",
    "/football/epl/match/205",
  );
});

it("includes NRL clubs from the draw, linked to their club pages", async () => {
  const dialog = open();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "roo" } });
  const clubs = await within(dialog).findByRole("region", { name: "Clubs" });
  expect(within(clubs).getByRole("link", { name: /Roosters/ })).toHaveAttribute("href", "/nrl/team/7");
});

it("says so when nothing matches", async () => {
  open();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzzz" } });
  await waitFor(() => expect(screen.getByText(/Nothing matches/)).toBeInTheDocument());
});

it("closes on Escape and returns focus to the magnifier", () => {
  open();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Search" })).toHaveFocus();
});

it("keeps the page list honest: every competition tab and the about pages", () => {
  const hrefs = pageItems("nrl").map((p) => p.href);
  expect(hrefs).toEqual(expect.arrayContaining(["/nrl", "/nrl/ladder", "/nrl/tips", "/nrl/leaderboard", "/about", "/privacy", "/terms"]));
  expect(searchGroups("", "nrl", { clubs: [], matches: {} })[0].heading).toBe("Go to");
});

it("has a clear button inside the field that empties it and keeps focus in the field", () => {
  open();
  const box = screen.getByRole("searchbox");
  expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
  fireEvent.change(box, { target: { value: "ars" } });
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(box).toHaveValue("");
  expect(box).toHaveFocus();
  expect(screen.getByRole("region", { name: "Go to" })).toBeInTheDocument();
});

describe("matches around now", () => {
  const NOW = Date.parse("2026-11-20T12:00:00Z");
  const m = (id: number, label: string, iso: string, final: SearchItem["final"] = null, mw = 1): SearchItem => ({
    kind: "match",
    label,
    context: `Matchweek ${mw}`,
    href: `/football/epl/match/${id}`,
    kickoff: Date.parse(iso),
    final,
  });
  const season = [
    m(1, "Arsenal v Brighton", "2027-05-23T15:00:00Z", null, 38),
    m(2, "Arsenal v Aston Villa", "2027-04-18T15:00:00Z", null, 32),
    m(3, "Newcastle v Arsenal", "2026-11-22T16:30:00Z", null, 11),
    m(4, "Arsenal v Man City", "2026-11-30T20:00:00Z", null, 12),
    m(5, "Arsenal v Hull City", "2026-11-08T14:00:00Z", { home: 2, away: 1 }, 10),
    m(6, "Arsenal v Coventry", "2026-08-21T19:00:00Z", { home: 3, away: 0 }, 1),
    m(7, "Chelsea v Arsenal", "2026-12-05T17:30:00Z", null, 13),
  ];

  it("lists upcoming fixtures by kick-off, then the latest result, capped at four", () => {
    expect(nearestMatches(season, NOW).map((x) => x.href.split("/").pop())).toEqual(["3", "4", "7", "5"]);
  });

  it("fills with results when few fixtures are left, newest first", () => {
    const late = Date.parse("2027-05-01T00:00:00Z");
    expect(nearestMatches(season, late).map((x) => x.href.split("/").pop())).toEqual(["1", "5", "6"]);
  });

  it("drops an open fixture whose kick-off is long gone", () => {
    const stale = m(8, "Arsenal v Fulham", "2026-11-01T15:00:00Z");
    expect(nearestMatches([stale], NOW)).toEqual([]);
  });

  it("orders the 'Matches' group around now rather than alphabetically", () => {
    const groups = searchGroups("ars", "epl", { clubs: [], matches: { epl: season } }, NOW);
    const matches = groups.find((g) => g.heading === "Matches")!;
    expect(matches.items.map((x) => x.label)).toEqual([
      "Newcastle v Arsenal",
      "Arsenal v Man City",
      "Chelsea v Arsenal",
      "Arsenal v Hull City",
    ]);
  });

  it("shows kick-off for an open fixture and the real final score for a finished one, never a model figure", () => {
    expect(contextFor(season[2], "Europe/London")).toBe("Matchweek 11 · Sunday 22 November · 4:30 pm");
    expect(contextFor(season[4], "Europe/London")).toBe("Matchweek 10 · Full time 2–1");
    expect(contextFor({ ...season[2], live: true }, "UTC")).toBe("Matchweek 11 · Live");
  });

  it("reads status, scores and kick-off from the season list, and nothing from the model", async () => {
    mockApi.getUpcomingMatches.mockResolvedValue([
      {
        match_id: 197, kickoff_utc: "2026-11-08T14:00:00Z", status: "finished", matchweek: 10,
        score_home: 2, score_away: 1, teams: { home: "Arsenal", away: "Hull City" },
        predicted_score: { home: 3, away: 0 }, probabilities: { home_win: 0.61, draw: 0.2, away_win: 0.19 },
      },
      {
        match_id: 999, kickoff_utc: "2099-01-01T15:00:00Z", status: "scheduled", matchweek: 30,
        score_home: null, score_away: null, teams: { home: "Arsenal", away: "Leeds" },
        predicted_score: { home: 4, away: 0 }, probabilities: { home_win: 0.77, draw: 0.13, away_win: 0.1 },
      },
    ] as never);
    render(<SiteSearch competition="laliga" />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "arsenal v" } });
    const matches = await screen.findByRole("region", { name: "Matches" });
    const links = within(matches).getAllByRole("link");
    expect(links[0]).toHaveTextContent("Arsenal v Leeds");
    expect(links[1]).toHaveTextContent("Full time 2–1");
    expect(matches.textContent).not.toMatch(/%|3–0|4–0|61|77/);
  });
});

it("gives UFC its own pages, Card, Events, My picks and Leaderboard, in the page list and the empty-query list", () => {
  const own = [
    ["Card", "/ufc"],
    ["Events", "/ufc/events"],
    ["My picks", "/ufc/picks"],
    ["Leaderboard", "/ufc/leaderboard"],
  ];
  expect(pageItems("ufc").filter((p) => p.context === "UFC").map((p) => [p.label, p.href])).toEqual(own);
  expect(goToItems("ufc").slice(0, 4).map((p) => [p.label, p.href])).toEqual(own);
});
