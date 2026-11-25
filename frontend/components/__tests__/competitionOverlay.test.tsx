/** CompetitionOverlay — the header's competition pill and its dropdown menu
 *  (direction G; it used to be a full-screen overlay with a "default" star).
 *  The pill names the scoped competition; the menu lists every enabled
 *  competition with its real logo, grouped, and choosing one remembers it
 *  (fw_comp) and records the switch once. Keyboard: arrows move, Escape
 *  closes and returns focus, focus starts on the first item. */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CompetitionOverlay } from "@/components/CompetitionOverlay";
import { COMPETITIONS } from "@/lib/sports";
import {
  COMPETITION_COOKIE,
  readCompetitionCookie,
  writeCompetitionCookie,
} from "@/lib/competitionPrefs";
import { trackEvent } from "@/lib/analytics";

jest.mock("@/lib/analytics", () => ({ trackEvent: jest.fn() }));
const mockTrack = trackEvent as jest.MockedFunction<typeof trackEvent>;

let mockPath = "/";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPath,
}));

afterEach(() => {
  mockPath = "/";
  document.cookie = `${COMPETITION_COOKIE}=; Max-Age=0; Path=/`;
  jest.clearAllMocks();
});

const pill = (label: string) => screen.getByRole("button", { name: `Competition: ${label}` });

const openAt = (path: string, label: string) => {
  mockPath = path;
  render(<CompetitionOverlay />);
  fireEvent.click(pill(label));
  return screen.getByRole("menu", { name: `Competition: ${label}` });
};

describe("pill scope", () => {
  it("defaults an unscoped route to the Premier League, never WC26", () => {
    render(<CompetitionOverlay />);
    expect(pill("Premier League")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /World Cup/ })).not.toBeInTheDocument();
  });

  it("follows the URL on competition routes", () => {
    mockPath = "/football/wc26/fixtures";
    render(<CompetitionOverlay />);
    expect(pill("World Cup 2026")).toBeInTheDocument();
  });

  it("follows the remembered competition on unscoped routes", () => {
    writeCompetitionCookie("nrl");
    render(<CompetitionOverlay />);
    expect(pill("NRL")).toBeInTheDocument();
  });

  it("prefers the scope SiteNav passes in", () => {
    render(<CompetitionOverlay competition="bundesliga" />);
    expect(pill("Bundesliga")).toBeInTheDocument();
  });

  it("shows the competition's real logo in the pill", () => {
    render(<CompetitionOverlay competition="nrl" />);
    expect(pill("NRL").querySelector("img")).not.toBeNull();
  });
});

describe("menu", () => {
  it("lists every enabled competition, each once, with its logo", () => {
    const menu = openAt("/", "Premier League");
    const items = within(menu).getAllByRole("menuitem");
    const enabled = Object.values(COMPETITIONS).filter((c) => c.enabled);
    expect(items.map((i) => i.getAttribute("href"))).toEqual(
      expect.arrayContaining(enabled.map((c) => c.basePath)),
    );
    expect(items).toHaveLength(enabled.length);
    // UFC has no logo file, so its mark is a text monogram, not an img; every other row has a real logo.
    for (const item of items) {
      expect(item.querySelector("[data-competition-logo]")).not.toBeNull();
      if (item.getAttribute("href") !== "/ufc") expect(item.querySelector("img")).not.toBeNull();
    }
  });

  it("groups live football, rugby league, mixed martial arts and past tournaments", () => {
    const menu = openAt("/", "Premier League");
    const groups = within(menu).getAllByRole("group").map((g) => g.getAttribute("aria-label"));
    expect(groups).toEqual(["Football", "Rugby league", "Mixed martial arts", "Past tournaments"]);
    const past = within(menu).getByRole("group", { name: "Past tournaments" });
    expect(within(past).getByRole("menuitem", { name: /World Cup 2026/ })).toHaveAttribute(
      "href",
      "/football/wc26",
    );
  });

  it("marks the scoped competition as the current page", () => {
    const menu = openAt("/football/laliga", "La Liga");
    expect(within(menu).getByRole("menuitem", { name: /La Liga/ })).toHaveAttribute("aria-current", "page");
    expect(within(menu).getByRole("menuitem", { name: /NRL/ })).not.toHaveAttribute("aria-current");
  });

  it("gives every row a 44px target", () => {
    const menu = openAt("/", "Premier League");
    for (const item of within(menu).getAllByRole("menuitem")) expect(item.className).toContain("min-h-[44px]");
  });
});

it("records a switcher choice once, remembers it, and closes", () => {
  const menu = openAt("/", "Premier League");
  fireEvent.click(within(menu).getByRole("menuitem", { name: /NRL/ }));
  expect(readCompetitionCookie()).toBe("nrl");
  expect(mockTrack).toHaveBeenCalledTimes(1);
  expect(mockTrack).toHaveBeenCalledWith("competition_switch", {
    from: "epl",
    to: "nrl",
    source: "switcher",
  });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("records choosing UFC but keeps the previous remembered competition", () => {
  writeCompetitionCookie("nrl");
  const menu = openAt("/football/epl", "Premier League");
  fireEvent.click(within(menu).getByRole("menuitem", { name: /UFC/ }));
  expect(readCompetitionCookie()).toBe("nrl");
  expect(mockTrack).toHaveBeenCalledTimes(1);
  expect(mockTrack).toHaveBeenCalledWith("competition_switch", {
    from: "epl",
    to: "ufc",
    source: "switcher",
  });
});

it("does not report re-choosing the current competition", () => {
  const menu = openAt("/football/epl", "Premier League");
  fireEvent.click(within(menu).getByRole("menuitem", { name: /Premier League/ }));
  expect(mockTrack).not.toHaveBeenCalled();
});

describe("keyboard", () => {
  it("opens with focus on the first item and reflects aria-expanded", () => {
    const menu = openAt("/", "Premier League");
    expect(pill("Premier League")).toHaveAttribute("aria-expanded", "true");
    expect(within(menu).getAllByRole("menuitem")[0]).toHaveFocus();
  });

  it("moves with the arrow keys and wraps", () => {
    const menu = openAt("/", "Premier League");
    const items = within(menu).getAllByRole("menuitem");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(items[items.length - 1]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(items[0]).toHaveFocus();
  });

  it("Escape closes the menu and returns focus to the pill", () => {
    const menu = openAt("/", "Premier League");
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(pill("Premier League")).toHaveFocus();
  });

  it("opens from the pill with ArrowDown", () => {
    render(<CompetitionOverlay />);
    fireEvent.keyDown(pill("Premier League"), { key: "ArrowDown" });
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("closes on a click outside", () => {
    openAt("/", "Premier League");
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
