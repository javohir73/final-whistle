/** AccountMenu navigation entries, scoped like the rest of the shell: "My
 *  picks" for the current competition, and "Model record" where that
 *  competition has a record page (NRL's ledger, /record for the World Cup;
 *  club leagues get theirs in Phase 2, so none is offered yet). */
import { fireEvent, render, screen } from "@testing-library/react";
import { AccountMenu } from "@/components/AccountMenu";
import { COMPETITION_COOKIE, writeCompetitionCookie } from "@/lib/competitionPrefs";
import type { SessionUser } from "@/lib/session";

let mockPath = "/";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPath,
  useSearchParams: () => new URLSearchParams(),
}));

const user: SessionUser = {
  id: 1,
  email: "pat@example.com",
  display_name: "Pat",
  avatar_url: null,
  premium: false,
};

const openAt = (path: string) => {
  mockPath = path;
  render(<AccountMenu user={user} onLogout={jest.fn()} onDeleteAccount={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /account: pat/i }));
};

afterEach(() => {
  mockPath = "/";
  document.cookie = `${COMPETITION_COOKIE}=; Max-Age=0; Path=/`;
});

it("links My picks to the current competition (EPL by default)", () => {
  openAt("/");
  expect(screen.getByRole("menuitem", { name: "My picks" })).toHaveAttribute(
    "href",
    "/leaderboard?competition=epl",
  );
});

it("follows the URL's competition", () => {
  openAt("/football/bundesliga/fixtures");
  expect(screen.getByRole("menuitem", { name: "My picks" })).toHaveAttribute(
    "href",
    "/leaderboard?competition=bundesliga",
  );
});

it("follows the remembered competition on unscoped routes", () => {
  writeCompetitionCookie("ucl");
  openAt("/methodology");
  expect(screen.getByRole("menuitem", { name: "My picks" })).toHaveAttribute(
    "href",
    "/leaderboard?competition=ucl",
  );
});

it.each([
  ["/nrl", "/nrl/record"],
  ["/football/wc26", "/record"],
])("offers the model record on %s -> %s", (path, href) => {
  openAt(path);
  expect(screen.getByRole("menuitem", { name: "Model record" })).toHaveAttribute("href", href);
});

it.each(["/football/epl", "/football/laliga", "/football/ucl"])(
  "offers no model record for a club league yet (%s)",
  (path) => {
    openAt(path);
    expect(screen.queryByRole("menuitem", { name: "Model record" })).not.toBeInTheDocument();
  },
);

it("closes the menu when an entry is chosen", () => {
  openAt("/nrl");
  fireEvent.click(screen.getByRole("menuitem", { name: "My picks" }));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("keeps the account actions after the navigation entries", () => {
  openAt("/nrl");
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "My picks",
    "Model record",
    "Sign out",
    "Delete account",
  ]);
});
