import { render, screen, within } from "@testing-library/react";
import { PlatformHome, nrlHomeStatus, nrlStatusLine } from "@/components/PlatformHome";
import { getNrlTipsheetServer } from "@/lib/api";
import { nrlStartLabel } from "@/lib/nrlTips";
import { COMPETITIONS, type CompetitionId } from "@/lib/sports";
import type { NrlTipsheet, NrlTipsheetMatch } from "@/lib/types";

jest.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));
// The Next-up strip fetches client-side; covered by its own test.
jest.mock("@/components/play/NextUpStrip", () => ({
  NextUpStrip: () => <section data-testid="next-up" />,
}));
jest.mock("@/lib/api");
const mockTipsheet = getNrlTipsheetServer as jest.MockedFunction<typeof getNrlTipsheetServer>;

const DAY = 86_400_000;
const NOV = new Date("2026-11-03T09:00:00Z");
function tipsheet(season: number, round: number, matches: Partial<NrlTipsheetMatch>[]): NrlTipsheet {
  return {
    season, round,
    matches: matches.map((m, i) => ({
      id: i + 1, match_no: i + 1, kickoff_utc: null, venue: null, home: "Home", away: "Away",
      home_team_id: 1, away_team_id: 2, score_home: null, score_away: null, status: "scheduled",
      prediction: null, ...m,
    })),
    record: {
      evaluated_matches: 0, winner_accuracy: null, winner_accuracy_ci95: null,
      avg_log_loss: null, avg_brier: null, best_streak: 0, last_updated: null,
    },
    worst_miss: null,
    disclaimer: "For analytics and entertainment only.",
  };
}
// The 2026 Grand Final round, decided: the season is complete.
const grandFinal = tipsheet(2026, 31, [
  { kickoff_utc: "2026-10-04T08:30:00Z", status: "finished", score_home: 19, score_away: 18 },
]);
beforeEach(() => mockTipsheet.mockResolvedValue(grandFinal));
afterEach(() => mockTipsheet.mockReset());

const competitionIds: CompetitionId[] = Object.values(COMPETITIONS).map(
  (competition) => competition.id,
);

const authoritativeCardSurfaces =
  "[data-competition-card], .competition-card__copy, .competition-card__arrow, [data-competition-logo]";
const nonColorTextUtility = /^text-(?:xs|sm|base|lg|xl|[2-9]xl|micro|mini|note|label|meta|body|lead|sub|numeral|headline|score(?:-sm)?|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip|\[(?:[\d.]+(?:px|rem|em|%|vw|vh)|clamp\(.+\))\])$/;

function classParts(className: string): string[] {
  const parts: string[] = [];
  let bracketDepth = 0;
  let start = 0;

  for (let index = 0; index < className.length; index += 1) {
    if (className[index] === "[") bracketDepth += 1;
    if (className[index] === "]") bracketDepth -= 1;
    if (className[index] === ":" && bracketDepth === 0) {
      parts.push(className.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(className.slice(start));
  return parts;
}

function normalizedUtility(className: string): string {
  return classParts(className).at(-1)!.replace(/^!|!$/g, "");
}

function isTextColorUtility(className: string): boolean {
  const name = normalizedUtility(className);
  return (
    (name.startsWith("text-") && !nonColorTextUtility.test(name)) ||
    /^\[color:.+\]$/.test(name)
  );
}

function isHoverTransformUtility(className: string): boolean {
  const parts = classParts(className);
  const name = normalizedUtility(className);
  const hasHoverVariant = parts.slice(0, -1).some((variant) => variant.includes("hover"));
  const changesTransform =
    /^(?:-?(?:translate-[xy]|rotate|skew-[xy])-.+|scale(?:-[xy])?-.+|transform(?:-.+)?|origin-.+)$/.test(
      name,
    ) || /^\[(?:transform|translate|rotate|scale|skew):.+\]$/.test(name);
  return hasHoverVariant && changesTransform;
}

const competitionsSection = () => document.getElementById("competitions")!;

describe("PlatformHome competition cards", () => {
  it("gives every competition the shared branded treatment as a compact row", async () => {
    const { container } = render(await PlatformHome());

    for (const id of competitionIds) {
      const card = container.querySelector(`[data-competition-card="${id}"]`);
      expect(card).toHaveClass("competition-card", "competition-card--wide", "rounded-2xl", "min-h-[72px]");
      expect(card).not.toHaveClass("h-[300px]");
      expect(card?.querySelector("[data-competition-logo]")).toBeInTheDocument();
      expect(card?.querySelector(".competition-card__copy")).toBeInTheDocument();
      expect(card?.querySelector(".competition-card__arrow")).toBeInTheDocument();
    }
    expect(container.querySelectorAll("[data-competition-card]")).toHaveLength(6);
  });

  it("keeps Tailwind text colours off every authoritative competition card surface", async () => {
    const { container } = render(await PlatformHome());
    const violations = Array.from(container.querySelectorAll(authoritativeCardSurfaces)).flatMap(
      (element) => Array.from(element.classList).filter(isTextColorUtility),
    );

    expect(violations).toEqual([]);
  });

  it("keeps Tailwind hover transforms off every authoritative competition card surface", async () => {
    const { container } = render(await PlatformHome());

    for (const element of container.querySelectorAll(authoritativeCardSurfaces)) {
      expect(Array.from(element.classList).filter(isHoverTransformUtility)).toEqual([]);
    }
  });

  it("lists live competitions first and the World Cup under Past tournaments", async () => {
    const { container } = render(await PlatformHome());
    const group = (name: string) =>
      Array.from(container.querySelectorAll(`[data-competition-group="${name}"] [data-competition-card]`)).map(
        (card) => card.getAttribute("data-competition-card"),
      );

    expect(group("football")).toEqual(["epl", "laliga", "bundesliga", "ucl"]);
    expect(group("rugby-league")).toEqual(["nrl"]);
    expect(group("past")).toEqual(["wc26"]);
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Football", "Rugby league", "Past tournaments"]);
  });

  it("gives each row a status line: picks open, league phase, NRL off-season, past tournament", async () => {
    render(await PlatformHome({ now: new Date("2026-11-03T09:00:00Z") }));

    expect(screen.getByRole("link", { name: /Premier League/ })).toHaveTextContent("Score picks open");
    expect(screen.getByRole("link", { name: /UEFA Champions League/ })).toHaveTextContent("League phase");
    expect(screen.getByRole("link", { name: /National Rugby League/ })).toHaveTextContent(
      "Season complete · back March 2027",
    );
    expect(screen.getByRole("link", { name: /World Cup 2026/ })).toHaveAttribute("href", "/football/wc26");
  });

  it("derives the NRL line from the calendar, so it can't go stale", async () => {
    expect(nrlStatusLine(new Date("2026-11-03T09:00:00Z"))).toBe("Season complete · back March 2027");
    expect(nrlStatusLine(new Date("2027-02-10T09:00:00Z"))).toBe("Season complete · back March 2027");
    expect(nrlStatusLine(new Date("2027-05-10T09:00:00Z"))).toBe("Round-by-round predictions, ladder and tips");
  });

  it("opens on the game itself: the hero, its CTAs and the Next-up strip inside it", async () => {
    render(await PlatformHome());

    // No cookie or path in jsdom: the nav scope falls back to the EPL.
    const hero = screen.getByRole("heading", { level: 1, name: "Beat the model at the Premier League." }).closest("section")!;
    expect(within(hero).getByRole("link", { name: /Make your picks/ })).toHaveAttribute(
      "href",
      "/play?competition=epl",
    );
    expect(within(hero).getByTestId("next-up")).toBeInTheDocument();
    expect(screen.queryByText("Model track record")).not.toBeInTheDocument();
    // The competitions follow the hero.
    expect(
      hero.compareDocumentPosition(competitionsSection()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("the NRL line follows the same season rule as /nrl (not just the calendar)", () => {
  it("complete: season over, back in March", () => {
    expect(nrlHomeStatus(grandFinal, NOV)).toEqual({ line: "Season complete · back March 2027", playable: false });
  });

  it("pre-season: next season's draw is loaded, Round 1 is months away", () => {
    const opener = new Date(NOV.getTime() + 100 * DAY).toISOString();
    expect(nrlHomeStatus(tipsheet(2027, 1, [{ kickoff_utc: opener }]), NOV)).toEqual({
      line: `Season 2027 starts ${nrlStartLabel(opener)}`,
      playable: false,
    });
  });

  it("in season: the current round", () => {
    const soon = new Date(NOV.getTime() + 2 * DAY).toISOString();
    expect(nrlHomeStatus(tipsheet(2027, 15, [{ kickoff_utc: soon }]), NOV)).toEqual({
      line: "Round 15 · predictions, ladder and tips",
      playable: true,
    });
  });

  it("falls back to the calendar only without data", () => {
    expect(nrlHomeStatus(null, NOV)).toEqual({ line: "Season complete · back March 2027", playable: false });
  });

  it("renders the pre-season line on the NRL row", async () => {
    const opener = new Date(NOV.getTime() + 100 * DAY).toISOString();
    mockTipsheet.mockResolvedValue(tipsheet(2027, 1, [{ kickoff_utc: opener }]));
    render(await PlatformHome({ now: NOV }));
    expect(screen.getByRole("link", { name: /National Rugby League/ })).toHaveTextContent(
      `Season 2027 starts ${nrlStartLabel(opener)}`,
    );
  });
});
