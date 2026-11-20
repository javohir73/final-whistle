/** Global search: built only from data the app already serves (team lists,
 *  the current competition's upcoming fixtures, the NRL draw, a static page
 *  list). Results are links, grouped; the dialog traps focus and Escape
 *  closes it and hands focus back to the magnifier. */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SiteSearch, searchGroups, pageItems } from "@/components/SiteSearch";
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
    { match_id: 205, kickoff_utc: "2026-11-21T17:30:00Z", matchweek: 11, teams: { home: "Newcastle", away: "Arsenal" } },
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
