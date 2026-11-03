/** Bottom nav (UX rebuild plan 2026-11 §3.1): ONE five-tab shell on every
 *  route except /embed -- Home, Fixtures, Table, Play, My picks -- scoped to
 *  the current competition. The set and order never change; only the
 *  destinations (and the Table slot's word) follow the scope, which resolves
 *  URL -> ?competition= -> fw_comp cookie -> EPL. */
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

const FIVE = ["Home", "Fixtures", "Table", "Play", "My picks"];

describe("one shell, same five tabs everywhere", () => {
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
  ])("renders Home · Fixtures · Table · Play · My picks on %s", (path) => {
    renderAt(path);
    expect(labels()).toEqual(FIVE);
  });

  it("keeps the order and ids for NRL and WC26; only the Table word changes", () => {
    renderAt("/nrl");
    expect(labels()).toEqual(["Home", "Fixtures", "Ladder", "Play", "My picks"]);
    const nrlIds = tabs().map((a) => a.getAttribute("data-tab"));
    expect(nrlIds).toEqual(["home", "fixtures", "table", "play", "mypicks"]);
  });

  it("labels WC26's table Groups", () => {
    renderAt("/football/wc26");
    expect(labels()).toEqual(["Home", "Fixtures", "Groups", "Play", "My picks"]);
  });

  it("calls UCL's table slot Table (League phase is a page heading)", () => {
    renderAt("/football/ucl");
    expect(labels()).toEqual(FIVE);
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
      "/football/laliga/fixtures",
      "/football/laliga/standings",
      "/play?competition=laliga",
      "/leaderboard?competition=laliga",
    ]);
  });

  it("routes NRL to its own slugs and its own Play surface", () => {
    renderAt("/nrl/ladder");
    expect(hrefs()).toEqual([
      "/nrl",
      "/nrl/matches",
      "/nrl/ladder",
      "/nrl/tips",
      "/leaderboard?competition=nrl",
    ]);
  });

  it("routes WC26's table to its group tables", () => {
    renderAt("/football/wc26/fixtures");
    expect(screen.getByRole("link", { name: /Groups/ })).toHaveAttribute(
      "href",
      "/football/wc26/groups",
    );
  });

  it("defaults unscoped routes to the Premier League, never WC26", () => {
    renderAt("/");
    expect(hrefs()[0]).toBe("/football/epl");
    expect(hrefs().join(" ")).not.toContain("wc26");
  });

  it("keeps a ?competition= scope on Play and My picks", () => {
    renderAt("/play", "competition=nrl");
    expect(hrefs()).toEqual([
      "/nrl",
      "/nrl/matches",
      "/nrl/ladder",
      "/nrl/tips",
      "/leaderboard?competition=nrl",
    ]);
  });

  it("ignores a bogus ?competition= value (including prototype keys)", () => {
    renderAt("/play", "competition=toString");
    expect(hrefs()[0]).toBe("/football/epl");
  });

  it("scopes unscoped routes to the fw_comp cookie", () => {
    writeCompetitionCookie("nrl");
    renderAt("/methodology");
    expect(hrefs()[0]).toBe("/nrl");
    expect(labels()[2]).toBe("Ladder");
  });

  it("lets the URL beat the cookie", () => {
    writeCompetitionCookie("nrl");
    renderAt("/football/bundesliga");
    expect(hrefs()[0]).toBe("/football/bundesliga");
  });

  it("re-scopes live when the cookie changes (switcher / Set as default)", () => {
    renderAt("/");
    expect(hrefs()[0]).toBe("/football/epl");
    act(() => writeCompetitionCookie("ucl"));
    expect(hrefs()[0]).toBe("/football/ucl");
  });
});

describe("active state", () => {
  it.each([
    ["/football/epl", "Home"], // exact match only
    ["/football/epl/fixtures", "Fixtures"],
    ["/football/epl/match/198", "Fixtures"], // match pages light Fixtures
    ["/football/epl/standings", "Table"],
    ["/football/ucl/standings", "Table"],
    ["/football/wc26/groups", "Groups"],
    ["/football/wc26/groups/2", "Groups"],
    ["/football/wc26/bracket", "Play"],
    ["/play", "Play"],
    ["/tips", "Play"],
    ["/nrl", "Home"],
    ["/nrl/matches", "Fixtures"],
    ["/nrl/match/2026/27/1", "Fixtures"],
    ["/nrl/round/27", "Fixtures"],
    ["/nrl/ladder", "Ladder"],
    ["/nrl/run-home", "Ladder"],
    ["/nrl/tips", "Play"],
    ["/nrl/leaderboard", "My picks"],
    ["/nrl/record", "My picks"],
    ["/leaderboard", "My picks"],
    ["/record", "My picks"],
    ["/about", "My picks"],
    ["/methodology", "My picks"],
    ["/privacy", "My picks"],
    ["/terms", "My picks"],
  ])("lights exactly one tab on %s (%s)", (path, label) => {
    renderAt(path);
    expect(current()).toEqual([label]);
  });

  it.each(["/", "/index", "/premium", "/football", "/football/epl/team/3", "/nrl/origin"])(
    "lights no tab on %s",
    (path) => {
      renderAt(path);
      expect(current()).toEqual([]);
    },
  );

  it("does not light Home on a competition's sub-pages", () => {
    renderAt("/football/epl/fixtures");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

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

it("keeps 44px targets and the deep lime for the active tab", () => {
  renderAt("/football/epl");
  for (const link of tabs()) expect(link.className).toContain("min-h-[44px]");
  expect(screen.getByRole("link", { name: "Home" }).className).toContain("text-lime-deep");
});

it("keeps the safe-area inset on the fixed bar", () => {
  renderAt("/");
  const nav = screen.getByRole("navigation", { name: "Primary" });
  // env() lives in the .safe-bottom/.safe-x utility classes (jsdom's CSSOM
  // can't represent env() inline styles).
  expect(nav.className).toContain("safe-bottom");
  expect(nav.className).toContain("safe-x");
});
