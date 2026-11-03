/** CompetitionProvider keeps fw_comp in step with the URL on client-side
 *  navigations (middleware only sees page loads), path first, then
 *  `?competition=` on unscoped routes, and migrates the old localStorage star
 *  once -- without letting it beat a competition the URL names. */
import { render } from "@testing-library/react";
import { CompetitionProvider, useCompetitionScope } from "@/components/TournamentProvider";
import { COMPETITION_COOKIE, readCompetitionCookie, writeCompetitionCookie } from "@/lib/competitionPrefs";
import { trackEvent } from "@/lib/analytics";

jest.mock("@/lib/analytics", () => ({ trackEvent: jest.fn() }));
const mockTrack = trackEvent as jest.MockedFunction<typeof trackEvent>;

let mockPath = "/";
let mockQuery = "";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPath,
  useSearchParams: () => new URLSearchParams(mockQuery),
}));

function Scope() {
  return <span data-testid="scope">{useCompetitionScope().competition}</span>;
}

const mount = (path: string, query = "") => {
  mockPath = path;
  mockQuery = query;
  return render(
    <CompetitionProvider>
      <Scope />
    </CompetitionProvider>,
  );
};

afterEach(() => {
  document.cookie = `${COMPETITION_COOKIE}=; Max-Age=0; Path=/`;
  window.localStorage.clear();
  jest.clearAllMocks();
});

it("adopts a competition path into fw_comp and reports the switch", () => {
  writeCompetitionCookie("epl");
  mount("/nrl/ladder");
  expect(readCompetitionCookie()).toBe("nrl");
  expect(mockTrack).toHaveBeenCalledWith("competition_switch", {
    from: "epl",
    to: "nrl",
    source: "navigation",
  });
});

it("adopts ?competition= on an unscoped route (same as middleware on page loads)", () => {
  writeCompetitionCookie("epl");
  const { getByTestId } = mount("/play", "competition=laliga");
  expect(readCompetitionCookie()).toBe("laliga");
  // Anything scoped by the cookie (the account menu) now agrees with the chip.
  expect(getByTestId("scope")).toHaveTextContent("laliga");
});

it("lets the path win over a stray ?competition=", () => {
  writeCompetitionCookie("epl");
  mount("/football/bundesliga", "competition=nrl");
  expect(readCompetitionCookie()).toBe("bundesliga");
});

it("leaves the cookie alone on an unscoped route without a query", () => {
  writeCompetitionCookie("ucl");
  mount("/methodology");
  expect(readCompetitionCookie()).toBe("ucl");
  expect(mockTrack).not.toHaveBeenCalled();
});

it("does not report a first visit (no previous competition) as a switch", () => {
  mount("/football/epl");
  expect(readCompetitionCookie()).toBe("epl");
  expect(mockTrack).not.toHaveBeenCalled();
});

it("does not remember an archived competition reached by path (old WC26 shares)", () => {
  writeCompetitionCookie("epl");
  mount("/football/wc26/match/45");
  expect(readCompetitionCookie()).toBe("epl");
  expect(mockTrack).not.toHaveBeenCalled();
});

it("does remember an archived competition chosen explicitly via ?competition=", () => {
  writeCompetitionCookie("epl");
  mount("/play", "competition=wc26");
  expect(readCompetitionCookie()).toBe("wc26");
});

it("ignores a bogus ?competition=", () => {
  writeCompetitionCookie("epl");
  mount("/play", "competition=toString");
  expect(readCompetitionCookie()).toBe("epl");
});

describe("old localStorage star", () => {
  it("migrates into the cookie on an unscoped route", () => {
    writeCompetitionCookie("epl"); // middleware's geo default on this first load
    window.localStorage.setItem("fw_pinned_comp", "nrl");
    mount("/");
    expect(readCompetitionCookie()).toBe("nrl");
    expect(window.localStorage.getItem("fw_pinned_comp")).toBeNull();
    // A migration is not a user switch.
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("still migrates on an archived page (browsing it is not a choice)", () => {
    writeCompetitionCookie("epl");
    window.localStorage.setItem("fw_pinned_comp", "nrl");
    mount("/football/wc26");
    expect(readCompetitionCookie()).toBe("nrl");
  });

  it("never beats a competition the URL names -- path or query", () => {
    window.localStorage.setItem("fw_pinned_comp", "nrl");
    writeCompetitionCookie("laliga");
    mount("/play", "competition=laliga");
    expect(readCompetitionCookie()).toBe("laliga");
    expect(window.localStorage.getItem("fw_pinned_comp")).toBeNull();
  });
});
