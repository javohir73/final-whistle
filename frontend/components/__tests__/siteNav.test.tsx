/** Top bar (direction G): the lg tab row is the same template as BottomNav
 *  (lib/sports.ts navTabsFor), and the competition pill shows on EVERY route
 *  -- including /, /play and /leaderboard. */
import { render, screen, within } from "@testing-library/react";
import { SiteNav } from "@/components/SiteNav";
import { BottomNav } from "@/components/BottomNav";
import { AuthProvider } from "@/components/AuthProvider";
import { COMPETITION_COOKIE, writeCompetitionCookie } from "@/lib/competitionPrefs";
import * as session from "@/lib/session";

// SiteNav renders AuthButton, which requires AuthProvider's context.
jest.mock("@/lib/session");
const mockGetMe = session.getMe as jest.MockedFunction<typeof session.getMe>;

let mockPath = "/";
let mockParams = new URLSearchParams();
jest.mock("next/navigation", () => ({
  usePathname: () => mockPath,
  useSearchParams: () => mockParams,
}));

beforeEach(() => {
  mockGetMe.mockResolvedValue(null); // signed out — irrelevant to nav scoping
});
afterEach(() => {
  mockPath = "/";
  mockParams = new URLSearchParams();
  document.cookie = `${COMPETITION_COOKIE}=; Max-Age=0; Path=/`;
  jest.resetAllMocks();
});

const renderNav = (path: string, query = "") => {
  mockPath = path;
  mockParams = new URLSearchParams(query);
  return render(
    <AuthProvider>
      <SiteNav />
    </AuthProvider>,
  );
};

/** The lg link row (the header's "Main" navigation). */
const row = () => within(screen.getByRole("navigation", { name: "Main" }));
const rowLabels = () => row().getAllByRole("link").map((a) => a.textContent);
const pill = (label: string) => screen.getByRole("button", { name: `Competition: ${label}` });

it.each(["/", "/play", "/leaderboard", "/premium", "/methodology", "/football/epl", "/nrl"])(
  "shows the competition tabs and the competition pill on %s",
  (path) => {
    renderNav(path);
    expect(rowLabels()).toEqual(
      path === "/nrl"
        ? ["Matches", "Ladder", "My tips", "Leaderboard"]
        : ["Matches", "Table", "My picks", "Leaderboard"],
    );
    expect(pill(path === "/nrl" ? "NRL" : "Premier League")).toHaveAttribute("aria-haspopup", "menu");
  },
);

it("offers search and sign in beside the pill", async () => {
  renderNav("/football/epl");
  expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
});

it("treats the root's /index ISR alias as the platform home (EPL scope, not WC26)", () => {
  // On Vercel, ISR revalidation of "/" renders with usePathname() === "/index".
  // The server must produce what the client renders for "/" or hydration
  // fails site-wide (React #418).
  renderNav("/index");
  expect(pill("Premier League")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /World Cup/ })).not.toBeInTheDocument();
  expect(row().getByRole("link", { name: "Matches" })).toHaveAttribute("href", "/football/epl");
});

it("scopes the pill and tabs to the URL on competition routes, underlining the current tab", () => {
  renderNav("/football/ucl/standings");
  expect(pill("UEFA Champions League")).toBeInTheDocument();
  expect(row().getByRole("link", { name: "Table" })).toHaveAttribute("href", "/football/ucl/standings");
  expect(row().getByRole("link", { name: "Table" })).toHaveAttribute("aria-current", "page");
  expect(row().getByRole("link", { name: "Table" })).toHaveClass("border-brand");
  expect(row().getByRole("link", { name: "Matches" })).not.toHaveAttribute("aria-current");
  // No bracket is advertised for a league.
  expect(screen.queryByRole("link", { name: "Bracket" })).not.toBeInTheDocument();
});

it("keeps the World Cup's bracket reachable from its tabs", () => {
  renderNav("/football/wc26/bracket");
  expect(row().getByRole("link", { name: "Bracket" })).toHaveAttribute("aria-current", "page");
  expect(row().getByRole("link", { name: "Groups" })).toHaveAttribute("href", "/football/wc26/groups");
});

it("scopes /play to ?competition= and lights My tips for the NRL", () => {
  renderNav("/play", "competition=nrl");
  expect(pill("NRL")).toBeInTheDocument();
  expect(row().getByRole("link", { name: "My tips" })).toHaveAttribute("href", "/nrl/tips");
  expect(row().getByRole("link", { name: "Leaderboard" })).toHaveAttribute("href", "/nrl/leaderboard");
});

it("lights My picks on /play for football", () => {
  renderNav("/play", "competition=epl");
  expect(row().getByRole("link", { name: "My picks" })).toHaveAttribute("aria-current", "page");
});

it("scopes unscoped routes to the remembered competition (fw_comp)", () => {
  writeCompetitionCookie("laliga");
  renderNav("/leaderboard");
  expect(pill("La Liga")).toBeInTheDocument();
  expect(row().getByRole("link", { name: "Leaderboard" })).toHaveAttribute("aria-current", "page");
  expect(row().getByRole("link", { name: "Matches" })).toHaveAttribute("href", "/football/laliga");
});

it("renders the same tab set as BottomNav for the same route", () => {
  for (const path of ["/", "/nrl/ladder", "/football/wc26/groups", "/play"]) {
    const { unmount } = renderNav(path);
    const header = rowLabels();
    const headerHrefs = row()
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    unmount();
    const bar = render(<BottomNav />);
    const bottom = within(screen.getByRole("navigation", { name: "Primary" }));
    expect(bottom.getAllByRole("link").map((a) => a.textContent)).toEqual(header);
    expect(bottom.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(headerHrefs);
    bar.unmount();
  }
});

it("renders no chrome on the partner embed", () => {
  const { container } = renderNav("/embed/198");
  expect(container.querySelector("header")).toBeNull();
});

it("gives the logo link a 44×44 touch target without moving the mark", () => {
  renderNav("/football/epl");
  const home = screen.getByRole("link", { name: "FinalWhistle home" });
  expect(home).toHaveClass("min-h-[44px]", "min-w-[44px]");
  // Padding grows the hit area; the equal negative margin keeps the layout.
  expect(home).toHaveClass("px-[7px]", "-mx-[7px]");
  expect(home.querySelector("svg")).toHaveClass("h-[27px]", "w-[30px]");
});
