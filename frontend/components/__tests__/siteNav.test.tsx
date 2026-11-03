/** Top bar: the desktop link row is the same five-tab template as BottomNav
 *  (lib/sports.ts navTabsFor), and the competition chip shows on EVERY route
 *  -- including /, /play and /leaderboard, where it used to be missing. */
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

/** The lg link row (the header's only div of nav links). */
const row = () => within(document.querySelector("header nav > div") as HTMLElement);
const rowLabels = () => row().getAllByRole("link").map((a) => a.textContent);
const chip = () => screen.getByRole("button", { expanded: false, name: /^[A-Z0-9]+$/ });

it.each(["/", "/play", "/leaderboard", "/premium", "/methodology", "/football/epl", "/nrl"])(
  "shows the five tabs and the competition chip on %s",
  (path) => {
    renderNav(path);
    expect(rowLabels()).toHaveLength(5);
    expect(rowLabels()[0]).toBe("Home");
    expect(rowLabels()[4]).toBe("My picks");
    expect(screen.getByRole("button", { name: path === "/nrl" ? "NRL" : "EPL" })).toHaveAttribute(
      "aria-haspopup",
      "dialog",
    );
  },
);

it("treats the root's /index ISR alias as the platform home (EPL scope, not WC26)", () => {
  // On Vercel, ISR revalidation of "/" renders with usePathname() === "/index".
  // The server must produce what the client renders for "/" or hydration
  // fails site-wide (React #418).
  renderNav("/index");
  expect(chip()).toHaveTextContent("EPL");
  expect(screen.queryByRole("button", { name: "WC26" })).not.toBeInTheDocument();
  expect(row().getByRole("link", { name: "Home" })).toHaveAttribute("href", "/football/epl");
});

it("scopes the chip and tabs to the URL on competition routes", () => {
  renderNav("/football/ucl/standings");
  expect(screen.getByRole("button", { name: "UCL" })).toBeInTheDocument();
  expect(row().getByRole("link", { name: "Table" })).toHaveAttribute(
    "href",
    "/football/ucl/standings",
  );
  expect(row().getByRole("link", { name: "Table" })).toHaveAttribute("aria-current", "page");
  // No bracket is advertised for a league.
  expect(screen.queryByRole("link", { name: "Bracket" })).not.toBeInTheDocument();
});

it("scopes /play to ?competition= and lights Play", () => {
  renderNav("/play", "competition=nrl");
  expect(screen.getByRole("button", { name: "NRL" })).toBeInTheDocument();
  expect(row().getByRole("link", { name: "Play" })).toHaveAttribute("href", "/nrl/tips");
  expect(row().getByRole("link", { name: "Play" })).toHaveAttribute("aria-current", "page");
  expect(row().getByRole("link", { name: "My picks" })).toHaveAttribute(
    "href",
    "/leaderboard?competition=nrl",
  );
});

it("scopes unscoped routes to the remembered competition (fw_comp)", () => {
  writeCompetitionCookie("laliga");
  renderNav("/leaderboard");
  expect(screen.getByRole("button", { name: "LaLiga" })).toBeInTheDocument();
  expect(row().getByRole("link", { name: "My picks" })).toHaveAttribute("aria-current", "page");
  expect(row().getByRole("link", { name: "Home" })).toHaveAttribute("href", "/football/laliga");
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
