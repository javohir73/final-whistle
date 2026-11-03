/** CompetitionOverlay — the header chip + full-screen competition switcher.
 *  The open panel must portal to <body>: SiteNav's header uses backdrop-blur,
 *  and any backdrop-filter makes that header the containing block for fixed
 *  descendants — rendered inline, the panel's "inset-0" resolves against the
 *  60px nav strip instead of the viewport (caught live on the P1 deploy). */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CompetitionOverlay } from "@/components/CompetitionOverlay";
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

const openAt = (path: string, name: string) => {
  mockPath = path;
  render(<CompetitionOverlay />);
  fireEvent.click(screen.getByRole("button", { name }));
  return screen.getByRole("dialog", { name: "Choose a competition" });
};

it("portals the open dialog out of the trigger's ancestor tree (backdrop-filter clipping regression)", () => {
  render(
    <div data-testid="header-shell">
      <CompetitionOverlay />
    </div>,
  );
  fireEvent.click(screen.getByRole("button", { name: "EPL" }));
  const dialog = screen.getByRole("dialog", { name: "Choose a competition" });
  expect(screen.getByTestId("header-shell")).not.toContainElement(dialog);
  expect(document.body).toContainElement(dialog);
});

describe("chip scope", () => {
  it("defaults an unscoped route to the Premier League, never WC26", () => {
    render(<CompetitionOverlay />);
    expect(screen.getByRole("button", { name: "EPL" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "WC26" })).not.toBeInTheDocument();
  });

  it("follows the URL on competition routes", () => {
    mockPath = "/football/wc26/groups";
    render(<CompetitionOverlay />);
    expect(screen.getByRole("button", { name: "WC26" })).toBeInTheDocument();
  });

  it("follows the remembered competition on unscoped routes", () => {
    writeCompetitionCookie("nrl");
    render(<CompetitionOverlay />);
    expect(screen.getByRole("button", { name: "NRL" })).toBeInTheDocument();
  });

  it("prefers the scope SiteNav passes in", () => {
    render(<CompetitionOverlay competition="bundesliga" />);
    expect(screen.getByRole("button", { name: "BUN" })).toBeInTheDocument();
  });
});

describe("sections", () => {
  it("groups live football, rugby league and past tournaments", () => {
    const dialog = openAt("/", "EPL");
    const headings = within(dialog)
      .getAllByRole("heading")
      .map((h) => h.textContent);
    expect(headings).toEqual(["Football", "Rugby league", "Past tournaments"]);
    expect(within(dialog).queryByText("Soon")).not.toBeInTheDocument();
  });

  it("files WC26 under Past tournaments, not among live competitions", () => {
    const dialog = openAt("/", "EPL");
    const sections = within(dialog).getAllByRole("list");
    const football = within(sections[0]).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(football).toEqual([
      "/football/epl",
      "/football/laliga",
      "/football/bundesliga",
      "/football/ucl",
    ]);
    expect(within(sections[2]).getByRole("link", { name: "World Cup 2026" })).toHaveAttribute(
      "href",
      "/football/wc26",
    );
  });

  it("names each competition once (no 'NRL NRL'), with the code chip kept visual-only", () => {
    const dialog = openAt("/", "EPL");
    expect(within(dialog).getByRole("link", { name: "NRL" })).toHaveAttribute("href", "/nrl");
    expect(within(dialog).getByRole("link", { name: "Premier League" })).toBeInTheDocument();
    // The NRL row has no chip at all (it would only repeat the name)...
    const nrlRow = within(dialog).getByRole("link", { name: "NRL" });
    expect(within(nrlRow).getAllByText("NRL")).toHaveLength(1);
    // ...and where a chip adds information it is visual-only.
    const eplChip = within(dialog).getByText("EPL");
    expect(eplChip).toHaveAttribute("aria-hidden", "true");
  });

  it("marks the scoped competition as the current page", () => {
    const dialog = openAt("/football/laliga", "LaLiga");
    expect(within(dialog).getByRole("link", { name: "La Liga" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("Set as default (fw_comp cookie)", () => {
  it("labels each star as a toggle and writes the cookie", () => {
    const dialog = openAt("/", "EPL");
    const star = within(dialog).getByRole("button", { name: "Set NRL as default" });
    expect(star).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(star);
    expect(readCompetitionCookie()).toBe("nrl");
    expect(star).toHaveAttribute("aria-pressed", "true");
    expect(mockTrack).toHaveBeenCalledWith("competition_switch", {
      from: "epl",
      to: "nrl",
      source: "set_default",
    });
  });

  it("re-scopes the chip immediately on an unscoped route", () => {
    const dialog = openAt("/", "EPL");
    fireEvent.click(within(dialog).getByRole("button", { name: "Set La Liga as default" }));
    expect(screen.getByRole("button", { name: "LaLiga" })).toBeInTheDocument();
  });

  it("lets the star choose the archived World Cup explicitly", () => {
    const dialog = openAt("/", "EPL");
    fireEvent.click(within(dialog).getByRole("button", { name: "Set World Cup 2026 as default" }));
    expect(readCompetitionCookie()).toBe("wc26");
  });

  it("clears the default when the pressed star is pressed again", () => {
    writeCompetitionCookie("nrl");
    const dialog = openAt("/", "NRL");
    const star = within(dialog).getByRole("button", { name: "Set NRL as default" });
    expect(star).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(star);
    expect(readCompetitionCookie()).toBeNull();
  });
});

it("records a switcher choice once and remembers it", () => {
  const dialog = openAt("/football/epl", "EPL");
  fireEvent.click(within(dialog).getByRole("link", { name: "NRL" }));
  expect(readCompetitionCookie()).toBe("nrl");
  expect(mockTrack).toHaveBeenCalledTimes(1);
  expect(mockTrack).toHaveBeenCalledWith("competition_switch", {
    from: "epl",
    to: "nrl",
    source: "switcher",
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("does not report re-choosing the current competition", () => {
  const dialog = openAt("/football/epl", "EPL");
  fireEvent.click(within(dialog).getByRole("link", { name: "Premier League" }));
  expect(mockTrack).not.toHaveBeenCalled();
});

describe("focus management", () => {
  it("moves focus into the dialog on open", () => {
    const dialog = openAt("/", "EPL");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("cycles Tab and Shift+Tab inside the dialog", () => {
    const dialog = openAt("/", "EPL");
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(first).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("leaves Tab alone between the ends", () => {
    const dialog = openAt("/", "EPL");
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
    );
    focusables[1].focus();
    const event = fireEvent.keyDown(dialog, { key: "Tab" });
    // Not prevented: the browser moves focus to the next element itself.
    expect(event).toBe(true);
  });

  it("Escape closes the dialog and returns focus to the trigger", () => {
    render(<CompetitionOverlay />);
    const trigger = screen.getByRole("button", { name: "EPL" });
    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("the close button returns focus to the trigger", () => {
    render(<CompetitionOverlay />);
    const trigger = screen.getByRole("button", { name: "EPL" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(trigger).toHaveFocus();
  });
});
