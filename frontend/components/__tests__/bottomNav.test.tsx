/** Bottom tab bar (direction G): the same competition tabs as the header row
 *  on every route except /embed -- Matches, Table, My picks, Leaderboard
 *  (NRL: Matches, Ladder, My tips, Leaderboard; WC26 adds Bracket) -- scoped
 *  to the current competition, which resolves URL -> ?competition= ->
 *  fw_comp cookie -> EPL. */
import { act, render, screen } from "@testing-library/react";
import { BottomNav } from "@/components/BottomNav";
import { COMPETITION_COOKIE, writeCompetitionCookie } from "@/lib/competitionPrefs";

let mockPath = "/";
let mockParams = new URLSearchParams();
jest.mock("next/navigation", () => ({
  usePathname: () => mockPath,
  useSearchParams: () => mockParams,
}));

const renderAt = (path: string, query = "") => {
  mockPath = path;
  mockParams = new URLSearchParams(query);
  return render(<BottomNav />);
};

const tabs = () => screen.getAllByRole("link");
const labels = () => tabs().map((a) => a.textContent);
const hrefs = () => tabs().map((a) => a.getAttribute("href"));
const current = () =>
  tabs()
    .filter((a) => a.getAttribute("aria-current") === "page")
    .map((a) => a.textContent);

afterEach(() => {
  mockPath = "/";
  mockParams = new URLSearchParams();
  document.cookie = `${COMPETITION_COOKIE}=; Max-Age=0; Path=/`;
});

const FOOTBALL = ["Matches", "Table", "My picks", "Leaderboard"];

describe("one shell, same tabs everywhere", () => {
  it.each([
    "/",
    "/play",
    "/leaderboard",
    "/premium",
    "/methodology",
    "/record",
    "/football",
    "/football/epl",
    "/football/epl/match/198",
    "/football/laliga/standings",
    "/football/ucl/standings",
    "/reset-password",
    "/tips/share/epl/9/pete",
  ])("renders Matches · Table · My picks · Leaderboard on %s", (path) => {
    renderAt(path);
    expect(labels()).toEqual(FOOTBALL);
  });

  it("words the NRL tabs Matches, Ladder, My tips, Leaderboard", () => {
    renderAt("/nrl");
    expect(labels()).toEqual(["Matches", "Ladder", "My tips", "Leaderboard"]);
    expect(tabs().map((a) => a.getAttribute("data-tab"))).toEqual(["matches", "table", "mypicks", "leaderboard"]);
  });

  it("gives WC26 its Groups and Bracket", () => {
    renderAt("/football/wc26");
    expect(labels()).toEqual(["Matches", "Groups", "Bracket", "My picks", "Leaderboard"]);
  });

  it("calls UCL's table slot Table (League phase is a page heading)", () => {
    renderAt("/football/ucl");
    expect(labels()).toEqual(FOOTBALL);
    expect(screen.queryByRole("link", { name: /League phase/ })).not.toBeInTheDocument();
  });

  it("renders nothing on the partner embed", () => {
    const { container } = renderAt("/embed/198");
    expect(container).toBeEmptyDOMElement();
  });
});

describe("destinations follow the competition scope", () => {
  it("routes a football league's tabs into its own space", () => {
    renderAt("/football/laliga/fixtures");
    expect(hrefs()).toEqual([
      "/football/laliga",
      "/football/laliga/standings",
      "/play?competition=laliga",
      "/leaderboard?competition=laliga",
    ]);
  });

  it("routes NRL to its own slugs, tips and leaderboard", () => {
    renderAt("/nrl/ladder");
    expect(hrefs()).toEqual(["/nrl", "/nrl/ladder", "/nrl/tips", "/nrl/leaderboard"]);
  });

  it("routes WC26's table to its group tables", () => {
    renderAt("/football/wc26/fixtures");
    expect(screen.getByRole("link", { name: /Groups/ })).toHaveAttribute("href", "/football/wc26/groups");
  });

  it("defaults unscoped routes to the Premier League, never WC26", () => {
    renderAt("/");
    expect(hrefs()[0]).toBe("/football/epl");
    expect(hrefs().join(" ")).not.toContain("wc26");
  });

  it("keeps a ?competition= scope", () => {
    renderAt("/play", "competition=nrl");
    expect(hrefs()).toEqual(["/nrl", "/nrl/ladder", "/nrl/tips", "/nrl/leaderboard"]);
  });

  it("ignores a bogus ?competition= value (including prototype keys)", () => {
    renderAt("/play", "competition=toString");
    expect(hrefs()[0]).toBe("/football/epl");
  });

  it("scopes unscoped routes to the fw_comp cookie", () => {
    writeCompetitionCookie("nrl");
    renderAt("/methodology");
    expect(hrefs()[0]).toBe("/nrl");
    expect(labels()[1]).toBe("Ladder");
  });

  it("lets the URL beat the cookie", () => {
    writeCompetitionCookie("nrl");
    renderAt("/football/bundesliga");
    expect(hrefs()[0]).toBe("/football/bundesliga");
  });

  it("re-scopes live when the cookie changes (the switcher)", () => {
    renderAt("/");
    expect(hrefs()[0]).toBe("/football/epl");
    act(() => writeCompetitionCookie("ucl"));
    expect(hrefs()[0]).toBe("/football/ucl");
  });
});

describe("active state", () => {
  it.each([
    ["/football/epl", "Matches"],
    ["/football/epl/fixtures", "Matches"],
    ["/football/epl/match/198", "Matches"],
    ["/football/epl/standings", "Table"],
    ["/football/epl/team/3", "Table"],
    ["/football/ucl/standings", "Table"],
    ["/football/wc26/groups", "Groups"],
    ["/football/wc26/groups/2", "Groups"],
    ["/football/wc26/bracket", "Bracket"],
    ["/play", "My picks"],
    ["/tips", "My picks"],
    ["/leaderboard", "Leaderboard"],
    ["/nrl", "Matches"],
    ["/nrl/matches", "Matches"],
    ["/nrl/match/2026/27/1", "Matches"],
    ["/nrl/round/27", "Matches"],
    ["/nrl/record", "Matches"],
    ["/nrl/origin", "Matches"],
    ["/nrl/ladder", "Ladder"],
    ["/nrl/run-home", "Ladder"],
    ["/nrl/team/4", "Ladder"],
    ["/nrl/tips", "My tips"],
    ["/nrl/leaderboard", "Leaderboard"],
  ])("lights exactly one tab on %s (%s)", (path, label) => {
    renderAt(path);
    expect(current()).toEqual([label]);
  });

  it.each(["/", "/index", "/premium", "/football", "/record", "/about", "/methodology", "/privacy", "/terms"])(
    "lights no tab on %s",
    (path) => {
      renderAt(path);
      expect(current()).toEqual([]);
    },
  );

  it("matches whole segments only", () => {
    renderAt("/playoffs");
    expect(current()).toEqual([]);
  });
});

it("treats the root's /index ISR alias exactly like /", () => {
  renderAt("/index");
  const atIndex = hrefs();
  document.body.innerHTML = "";
  renderAt("/");
  expect(hrefs()).toEqual(atIndex);
});

it("gives every tab an icon (looked up by id, not label)", () => {
  for (const path of ["/football/ucl/standings", "/nrl/ladder", "/football/wc26"]) {
    const { unmount } = renderAt(path);
    for (const link of tabs()) expect(link.querySelector("svg")).not.toBeNull();
    unmount();
  }
});

it("keeps 44px+ targets and paints the current tab in brand", () => {
  renderAt("/football/epl");
  for (const link of tabs()) expect(link.className).toContain("min-h-[56px]");
  expect(screen.getByRole("link", { name: "Matches" }).className).toContain("text-brand");
  expect(screen.getByRole("link", { name: "Table" }).className).toContain("text-muted");
});

it("sits on a white ground with a line on top", () => {
  renderAt("/");
  const nav = screen.getByRole("navigation", { name: "Primary" });
  expect(nav).toHaveClass("bg-ground", "border-t", "border-line", "lg:hidden");
});

it("keeps the safe-area inset on the fixed bar", () => {
  renderAt("/");
  const nav = screen.getByRole("navigation", { name: "Primary" });
  // env() lives in the .safe-bottom/.safe-x utility classes (jsdom's CSSOM
  // can't represent env() inline styles).
  expect(nav.className).toContain("safe-bottom");
  expect(nav.className).toContain("safe-x");
});

it("shows UFC's four tabs, with Card current on a fight page", () => {
  renderAt("/ufc/fight/1");
  expect(hrefs()).toEqual(["/ufc", "/ufc/events", "/ufc/picks", "/ufc/leaderboard"]);
  expect(labels()).toEqual(["Card", "Events", "My picks", "Leaderboard"]);
  expect(current()).toEqual(["Card"]);
});

it("marks UFC's My picks current on its page", () => {
  renderAt("/ufc/picks");
  expect(current()).toEqual(["My picks"]);
});

it("marks UFC's Leaderboard current on its page", () => {
  renderAt("/ufc/leaderboard");
  expect(current()).toEqual(["Leaderboard"]);
});
