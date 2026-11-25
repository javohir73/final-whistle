import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { UfcLeaderboardView } from "./UfcLeaderboardView";
import { useAuth } from "@/components/AuthProvider";
import { getOrCreateDeviceId } from "@/lib/session";
import { getUfcPicksSummary } from "@/lib/ufcPicks";
import type { UfcLeaderboardEntry, UfcLeaderboardResponse, UfcPicksSummaryResponse } from "@/lib/ufcTypes";

jest.mock("@/components/AuthProvider", () => ({ useAuth: jest.fn() }));
jest.mock("@/lib/session", () => ({ getOrCreateDeviceId: jest.fn() }));
jest.mock("@/lib/ufcPicks", () => ({ ...jest.requireActual("@/lib/ufcPicks"), getUfcPicksSummary: jest.fn() }));

const SLUG = "ufc-fight-night-x-2026-12-05";
const RULE = "Winner and method 5 points, winner 2. Ties go to more winner-and-method picks.";
const YEAR = 2026;
const openSignIn = jest.fn();

const entry = (o: Partial<UfcLeaderboardEntry> & Pick<UfcLeaderboardEntry, "rank" | "handle">): UfcLeaderboardEntry => ({
  points: 0, winner_method: 0, graded: 0, is_model: false, ...o,
});
const board = (o: Partial<UfcLeaderboardResponse> = {}): UfcLeaderboardResponse => ({
  scope: "card",
  event: { slug: SLUG, name: "UFC Fight Night: X v Y", first_bout_utc: "2026-12-05T20:00:00Z" },
  year: null, participant_count: 0, entries: [], ...o,
});
const yearBoard = (o: Partial<UfcLeaderboardResponse> = {}) => board({ scope: "year", event: null, year: YEAR, ...o });
// Equal totals are ordered by handle, as the API sends them.
const FULL = board({
  participant_count: 3,
  entries: [
    entry({ rank: 1, handle: "IronJaw", points: 12, winner_method: 2, graded: 4 }),
    entry({ rank: 2, handle: "QuietGrappler", points: 9, winner_method: 1, graded: 4 }),
    entry({ rank: 3, handle: "SwiftStriker42", points: 9, winner_method: 1, graded: 4 }),
    entry({ rank: 4, handle: "FinalWhistle model", points: 7, winner_method: 1, graded: 4, is_model: true }),
  ],
});
const summaryFor = (handle: string | null, points: number, winner_method: number, slug = SLUG): UfcPicksSummaryResponse => ({
  handle,
  cards: [{ slug, name: "X", first_bout_utc: "2026-12-05T20:00:00Z", picked: 4, graded: 4, points, winner_method }],
  totals: { picked: 4, graded: 4, points, winner_method },
});

beforeEach(() => {
  (useAuth as jest.Mock).mockReturnValue({ user: null, loading: false, openSignIn });
  (getOrCreateDeviceId as jest.Mock).mockReturnValue("dev-1");
  // Never answers unless a test says so: a late answer in a synchronous test would update outside act().
  (getUfcPicksSummary as jest.Mock).mockReturnValue(new Promise(() => {}));
});
afterEach(() => jest.clearAllMocks());

const card = { kind: "card", slug: SLUG } as const;
const yr = { kind: "year", year: YEAR } as const;
const props = { nextSlug: SLUG as string | null, currentYear: YEAR };
const rowsOf = () => screen.getAllByRole("row").slice(1);
const cell = (r: HTMLElement, i: number) => within(r).getAllByRole("cell")[i];

it("heads the page and shows the scoring line under the table", () => {
  render(<UfcLeaderboardView board={FULL} scope={card} {...props} />);
  expect(screen.getByText("UFC")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Leaderboard" })).toBeInTheDocument();
  expect(screen.getByText("UFC Fight Night: X v Y")).toBeInTheDocument();
  expect(screen.getByText(RULE)).toBeInTheDocument();
});

it("ranks players in payload order and marks the viewer and the model", async () => {
  (getUfcPicksSummary as jest.Mock).mockResolvedValue(summaryFor("SwiftStriker42", 9, 1));
  render(<UfcLeaderboardView board={FULL} scope={card} {...props} />);
  await screen.findByText("You");
  const rows = rowsOf();
  expect(rows.map((r) => cell(r, 0).textContent)).toEqual(["1", "2", "3", "4"]);
  expect(rows.map((r) => cell(r, 1).textContent)).toEqual([
    "IronJaw", "QuietGrappler", "SwiftStriker42You, you", "FinalWhistle modelModel, the site's model",
  ]);
  expect(cell(rows[3], 2)).toHaveTextContent("7");
  expect(cell(rows[3], 3)).toHaveTextContent("1");
  expect(screen.getByRole("columnheader", { name: "Winner and method" })).toBeInTheDocument();
  expect(rows[2].className).toContain("bg-brand-soft");
  expect(rows[1].className).not.toContain("bg-brand-soft");
  expect(screen.getByText("You are 3 of 4.")).toBeInTheDocument();
});

it("agrees with the table when the model ranks first: the row's own rank, of the rows shown", async () => {
  (getUfcPicksSummary as jest.Mock).mockResolvedValue(summaryFor("SwiftStriker42", 4, 0));
  const b = board({
    participant_count: 2,
    entries: [
      entry({ rank: 1, handle: "FinalWhistle model", points: 9, winner_method: 1, graded: 4, is_model: true }),
      entry({ rank: 2, handle: "IronJaw", points: 7, winner_method: 1, graded: 4 }),
      entry({ rank: 3, handle: "SwiftStriker42", points: 4, graded: 4 }),
    ],
  });
  render(<UfcLeaderboardView board={b} scope={card} {...props} />);
  expect(await screen.findByText("You are 3 of 3.")).toBeInTheDocument();
  expect(rowsOf().map((r) => cell(r, 0).textContent)).toEqual(["1", "2", "3"]);
});

it("says nobody is you when two players share your handle and totals", async () => {
  (getUfcPicksSummary as jest.Mock).mockResolvedValue(summaryFor("SwiftStriker42", 9, 1));
  const b = board({
    participant_count: 2,
    entries: [
      entry({ rank: 1, handle: "SwiftStriker42", points: 9, winner_method: 1, graded: 4 }),
      entry({ rank: 2, handle: "SwiftStriker42", points: 9, winner_method: 1, graded: 4 }),
    ],
  });
  render(<UfcLeaderboardView board={b} scope={card} {...props} />);
  await waitFor(() => expect(getUfcPicksSummary).toHaveBeenCalled());
  await Promise.resolve();
  expect(screen.queryByText("You")).toBeNull();
  expect(screen.queryByText(/^You are/)).toBeNull();
  expect(rowsOf().every((r) => !r.className.includes("bg-brand-soft"))).toBe(true);
});

it("marks only the namesake whose totals are yours", async () => {
  (getUfcPicksSummary as jest.Mock).mockResolvedValue(summaryFor("SwiftStriker42", 5, 1));
  const b = board({
    participant_count: 2,
    entries: [
      entry({ rank: 1, handle: "SwiftStriker42", points: 12, winner_method: 2, graded: 4 }),
      entry({ rank: 2, handle: "SwiftStriker42", points: 5, winner_method: 1, graded: 4 }),
    ],
  });
  render(<UfcLeaderboardView board={b} scope={card} {...props} />);
  await screen.findByText("You");
  const rows = rowsOf();
  expect(within(rows[0]).queryByText("You")).toBeNull();
  expect(within(rows[1]).getByText("You")).toBeInTheDocument();
  expect(screen.getByText("You are 2 of 2.")).toBeInTheDocument();
});

it("shows no You tag or rank line when the lookup says nothing certain", async () => {
  render(<UfcLeaderboardView board={FULL} scope={card} {...props} />);
  await waitFor(() => expect(getUfcPicksSummary).toHaveBeenCalled());
  expect(screen.queryByText("You")).toBeNull();
  expect(screen.queryByText(/^You are/)).toBeNull();
});

it("does not mark the model's row as the viewer when a player shares the model's name", async () => {
  (getUfcPicksSummary as jest.Mock).mockResolvedValue(summaryFor("FinalWhistle model", 5, 1));
  const b = board({
    participant_count: 1,
    entries: [
      entry({ rank: 1, handle: "FinalWhistle model", points: 5, winner_method: 1, graded: 1 }),
      entry({ rank: 2, handle: "FinalWhistle model", points: 5, winner_method: 1, graded: 1, is_model: true }),
    ],
  });
  render(<UfcLeaderboardView board={b} scope={card} {...props} />);
  await screen.findByText("You");
  const rows = rowsOf();
  expect(within(rows[0]).getByText("You")).toBeInTheDocument();
  expect(within(rows[1]).queryByText("You")).toBeNull();
  expect(within(rows[1]).getByText("Model")).toBeInTheDocument();
  expect(within(rows[0]).queryByText("Model")).toBeNull();
});

it("reads a handle that imitates the model differently from the model's row", () => {
  const b = board({
    participant_count: 1,
    entries: [
      entry({ rank: 1, handle: "FinalWhistle model Model", points: 5, winner_method: 1, graded: 1 }),
      entry({ rank: 2, handle: "FinalWhistle model", points: 2, graded: 1, is_model: true }),
    ],
  });
  render(<UfcLeaderboardView board={b} scope={card} {...props} />);
  const [fake, real] = rowsOf();
  expect(cell(fake, 1).textContent).toBe("FinalWhistle model Model");
  expect(cell(real, 1).textContent).toBe("FinalWhistle modelModel, the site's model");
  expect(within(fake).queryByText("Model")).toBeNull();
});

it("shows no model row, and nothing about a model, when the API sends none", () => {
  const b = board({ participant_count: 1, entries: [entry({ rank: 1, handle: "IronJaw", points: 5, winner_method: 1, graded: 1 })] });
  render(<UfcLeaderboardView board={b} scope={card} {...props} />);
  expect(screen.getAllByRole("row")).toHaveLength(2);
  expect(screen.queryByText(/model/i)).toBeNull();
});

it("shows handles as text and lets long or odd handles wrap", () => {
  const long = "A".repeat(60);
  const html = "<img src=x onerror=alert(1)>";
  const b = board({
    participant_count: 2,
    entries: [entry({ rank: 1, handle: long, points: 5 }), entry({ rank: 2, handle: html, points: 2 })],
  });
  const { container } = render(<UfcLeaderboardView board={b} scope={card} {...props} />);
  expect(screen.getByText(html)).toBeInTheDocument();
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText(long).className).toContain("[overflow-wrap:anywhere]");
  expect(screen.getByText(long).className).not.toContain("nowrap");
});

it("explains an empty card board, with a way to the next card", () => {
  render(<UfcLeaderboardView board={board()} scope={card} {...props} />);
  expect(screen.getByText("No fights on this card have been scored yet. The board fills in as results come in.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Pick the next card" })).toHaveAttribute("href", "/ufc");
  expect(screen.getByText(RULE)).toBeInTheDocument();
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByText(/model/i)).toBeNull();
});

it("explains an empty year, the default view's empty state", () => {
  render(<UfcLeaderboardView board={yearBoard()} scope={yr} {...props} />);
  expect(screen.getByText("No fights have been scored in 2026 yet.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Pick the next card" })).toHaveAttribute("href", "/ufc");
  expect(screen.getByText(RULE)).toBeInTheDocument();
  expect(screen.getByText("2026", { selector: "p" })).toBeInTheDocument();
});

it("shows a year board", async () => {
  (getUfcPicksSummary as jest.Mock).mockResolvedValue(summaryFor("IronJaw", 14, 2));
  const b = yearBoard({ participant_count: 1, entries: [entry({ rank: 1, handle: "IronJaw", points: 14, winner_method: 2, graded: 5 })] });
  render(<UfcLeaderboardView board={b} scope={yr} {...props} />);
  expect(screen.getByRole("cell", { name: /^IronJaw/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "2026" })).toHaveAttribute("aria-current", "page");
  expect(await screen.findByText("You are 1 of 1.")).toBeInTheDocument();
});

it("says when a card is not on the board", () => {
  render(<UfcLeaderboardView board={null} scope={{ kind: "card", slug: "no-such-card" }} {...props} />);
  expect(screen.getByRole("heading", { name: "That card is not on the leaderboard" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Leaderboard" })).toHaveAttribute("href", "/ufc/leaderboard");
  expect(screen.queryByRole("table")).toBeNull();
});

it("switches between this card and the year with plain links", () => {
  const { unmount } = render(<UfcLeaderboardView board={FULL} scope={card} {...props} />);
  const group = screen.getByRole("group", { name: "Show" });
  const thisCard = within(group).getByRole("link", { name: "This card" });
  expect(thisCard).toHaveAttribute("href", `/ufc/leaderboard?event=${SLUG}`);
  expect(thisCard).toHaveAttribute("aria-current", "page");
  const year = within(group).getByRole("link", { name: "2026" });
  expect(year).toHaveAttribute("href", "/ufc/leaderboard?view=year&year=2026");
  expect(year).not.toHaveAttribute("aria-current");
  unmount();

  render(<UfcLeaderboardView board={yearBoard()} scope={yr} {...props} />);
  const g2 = screen.getByRole("group", { name: "Show" });
  expect(within(g2).getByRole("link", { name: "2026" })).toHaveAttribute("aria-current", "page");
  const tc = within(g2).getByRole("link", { name: "This card" });
  expect(tc).toHaveAttribute("href", `/ufc/leaderboard?event=${SLUG}`);
  expect(tc).not.toHaveAttribute("aria-current");
});

it("names the card's own year in the year link, even a past one", () => {
  const b = board({ event: { slug: "ufc-old-2025-03-01", name: "UFC Old", first_bout_utc: "2025-03-01T20:00:00Z" } });
  render(<UfcLeaderboardView board={b} scope={{ kind: "card", slug: "ufc-old-2025-03-01" }} {...props} />);
  expect(screen.getByRole("link", { name: "2025" })).toHaveAttribute("href", "/ufc/leaderboard?view=year&year=2025");
});

it("offers no 'This card' switch on the year board when there is no next card", () => {
  render(<UfcLeaderboardView board={yearBoard()} scope={yr} nextSlug={null} currentYear={YEAR} />);
  expect(screen.queryByRole("link", { name: "This card" })).toBeNull();
  expect(screen.getByText("No fights have been scored in 2026 yet.")).toBeInTheDocument();
});

it("invites a signed-out visitor to sign in, and nobody else", () => {
  const { unmount } = render(<UfcLeaderboardView board={FULL} scope={card} {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Sign in to keep your picks across devices" }));
  expect(openSignIn).toHaveBeenCalled();
  unmount();
  (useAuth as jest.Mock).mockReturnValue({ user: { id: 1 }, loading: false, openSignIn });
  render(<UfcLeaderboardView board={FULL} scope={card} {...props} />);
  expect(screen.queryByRole("button", { name: /sign in/i })).toBeNull();
});

it("does not ask for the viewer when storage is blocked, and survives a failed lookup", async () => {
  (getOrCreateDeviceId as jest.Mock).mockReturnValue(null);
  const { unmount } = render(<UfcLeaderboardView board={FULL} scope={card} {...props} />);
  expect(getUfcPicksSummary).not.toHaveBeenCalled();
  unmount();
  (getOrCreateDeviceId as jest.Mock).mockReturnValue("dev-1");
  (getUfcPicksSummary as jest.Mock).mockRejectedValue(new Error("down"));
  render(<UfcLeaderboardView board={FULL} scope={card} {...props} />);
  await waitFor(() => expect(getUfcPicksSummary).toHaveBeenCalled());
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(screen.queryByText("You")).toBeNull();
});
