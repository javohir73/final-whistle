import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { UfcLeaderboardView } from "./UfcLeaderboardView";
import { useAuth } from "@/components/AuthProvider";
import { resetViewerHandleForTests } from "@/components/play/viewerHandle";
import { getOrCreateDeviceId } from "@/lib/session";
import { getUfcPicksSummary } from "@/lib/ufcPicks";
import type { UfcLeaderboardEntry, UfcLeaderboardResponse } from "@/lib/ufcTypes";

jest.mock("@/components/AuthProvider", () => ({ useAuth: jest.fn() }));
jest.mock("@/lib/session", () => ({ getOrCreateDeviceId: jest.fn() }));
jest.mock("@/lib/ufcPicks", () => ({ ...jest.requireActual("@/lib/ufcPicks"), getUfcPicksSummary: jest.fn() }));

const SLUG = "ufc-fight-night-x-2026-12-05";
const RULE = "Winner and method 5 points, winner 2. Ties go to more winner-and-method picks.";
const openSignIn = jest.fn();

const entry = (o: Partial<UfcLeaderboardEntry> & Pick<UfcLeaderboardEntry, "rank" | "handle">): UfcLeaderboardEntry => ({
  points: 0, winner_method: 0, graded: 0, is_model: false, ...o,
});
const board = (o: Partial<UfcLeaderboardResponse> = {}): UfcLeaderboardResponse => ({
  scope: "card",
  event: { slug: SLUG, name: "UFC Fight Night: X v Y", first_bout_utc: "2026-12-05T20:00:00Z" },
  year: null, participant_count: 0, entries: [], ...o,
});
const FULL = board({
  participant_count: 3,
  entries: [
    entry({ rank: 1, handle: "IronJaw", points: 12, winner_method: 2, graded: 4 }),
    entry({ rank: 2, handle: "SwiftStriker42", points: 9, winner_method: 1, graded: 4 }),
    entry({ rank: 3, handle: "QuietGrappler", points: 9, winner_method: 1, graded: 4 }),
    entry({ rank: 4, handle: "FinalWhistle model", points: 7, winner_method: 1, graded: 4, is_model: true }),
  ],
});

// Only the clock's date is faked ("this year" is the UTC year of now).
beforeEach(() => {
  jest.useFakeTimers({
    now: new Date("2026-12-05T00:00:00Z"),
    doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "nextTick", "queueMicrotask", "performance", "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback", "hrtime"],
  });
  resetViewerHandleForTests();
  (useAuth as jest.Mock).mockReturnValue({ user: null, loading: false, openSignIn });
  (getOrCreateDeviceId as jest.Mock).mockReturnValue("dev-1");
  (getUfcPicksSummary as jest.Mock).mockResolvedValue({ handle: null, cards: [], totals: {} });
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

const card = { kind: "card", slug: SLUG } as const;

it("heads the page and shows the scoring line under the table", () => {
  render(<UfcLeaderboardView board={FULL} scope={card} nextSlug={SLUG} />);
  expect(screen.getByText("UFC")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Leaderboard" })).toBeInTheDocument();
  expect(screen.getByText("UFC Fight Night: X v Y")).toBeInTheDocument();
  expect(screen.getByText(RULE)).toBeInTheDocument();
});

it("ranks players in payload order and marks the viewer and the model", async () => {
  (getUfcPicksSummary as jest.Mock).mockResolvedValue({ handle: "SwiftStriker42", cards: [], totals: {} });
  render(<UfcLeaderboardView board={FULL} scope={card} nextSlug={SLUG} />);
  await screen.findByText("You");
  const rows = screen.getAllByRole("row").slice(1);
  expect(rows.map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual(["1", "2", "3", "4"]);
  expect(rows.map((r) => within(r).getAllByRole("cell")[1].textContent)).toEqual([
    "IronJaw", "SwiftStriker42You", "QuietGrappler", "FinalWhistle modelModel",
  ]);
  expect(within(rows[3]).getByText("Model")).toBeInTheDocument();
  expect(within(rows[3]).getAllByRole("cell")[2]).toHaveTextContent("7");
  expect(within(rows[3]).getAllByRole("cell")[3]).toHaveTextContent("1");
  expect(screen.getByRole("columnheader", { name: "Winner and method" })).toBeInTheDocument();
  expect(within(rows[1]).getByText("You")).toBeInTheDocument();
  expect(rows[1].className).toContain("bg-brand-soft");
  expect(screen.getByText("You are 2 of 3.")).toBeInTheDocument();
  expect(within(rows[0]).queryByText("You")).toBeNull();
});

it("shows no You tag or rank line before the viewer is known, or when not on the board", async () => {
  render(<UfcLeaderboardView board={FULL} scope={card} nextSlug={SLUG} />);
  await waitFor(() => expect(getUfcPicksSummary).toHaveBeenCalled());
  expect(screen.queryByText("You")).toBeNull();
  expect(screen.queryByText(/^You are/)).toBeNull();
});

it("does not mark the model's row as the viewer when a player shares the model's name", async () => {
  (getUfcPicksSummary as jest.Mock).mockResolvedValue({ handle: "FinalWhistle model", cards: [], totals: {} });
  const b = board({
    participant_count: 1,
    entries: [
      entry({ rank: 1, handle: "FinalWhistle model", points: 5, winner_method: 1, graded: 1 }),
      entry({ rank: 2, handle: "FinalWhistle model", points: 2, graded: 1, is_model: true }),
    ],
  });
  render(<UfcLeaderboardView board={b} scope={card} nextSlug={SLUG} />);
  await screen.findByText("You");
  const rows = screen.getAllByRole("row").slice(1);
  expect(within(rows[0]).getByText("You")).toBeInTheDocument();
  expect(within(rows[1]).queryByText("You")).toBeNull();
  expect(within(rows[1]).getByText("Model")).toBeInTheDocument();
  expect(within(rows[0]).queryByText("Model")).toBeNull();
});

it("shows no model row, and nothing about a model, when the API sends none", () => {
  const b = board({ participant_count: 1, entries: [entry({ rank: 1, handle: "IronJaw", points: 5, winner_method: 1, graded: 1 })] });
  render(<UfcLeaderboardView board={b} scope={card} nextSlug={SLUG} />);
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
  const { container } = render(<UfcLeaderboardView board={b} scope={card} nextSlug={SLUG} />);
  expect(screen.getByText(html)).toBeInTheDocument();
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText(long).className).toContain("[overflow-wrap:anywhere]");
  expect(screen.getByText(long).className).not.toContain("nowrap");
});

it("explains an empty card board, with a way to the next card", () => {
  render(<UfcLeaderboardView board={board()} scope={card} nextSlug={SLUG} />);
  expect(screen.getByText("No fights on this card have been scored yet. The board fills in as results come in.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Pick the next card" })).toHaveAttribute("href", "/ufc");
  expect(screen.getByText(RULE)).toBeInTheDocument();
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByText(/model/i)).toBeNull();
});

it("reads the same when there is no card to show yet", () => {
  render(<UfcLeaderboardView board={null} scope={{ kind: "card", slug: null }} nextSlug={null} />);
  expect(screen.getByText("No fights on this card have been scored yet. The board fills in as results come in.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "This card" })).toHaveAttribute("href", "/ufc/leaderboard");
});

it("explains an empty year", () => {
  const b = board({ scope: "year", event: null, year: 2026 });
  render(<UfcLeaderboardView board={b} scope={{ kind: "year", year: 2026 }} nextSlug={SLUG} />);
  expect(screen.getByText("No fights have been scored in 2026 yet.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Pick the next card" })).toHaveAttribute("href", "/ufc");
  expect(screen.getByText("2026", { selector: "p" })).toBeInTheDocument();
});

it("shows a year board", () => {
  const b = board({ scope: "year", event: null, year: 2026, participant_count: 1, entries: [entry({ rank: 1, handle: "IronJaw", points: 14, winner_method: 2, graded: 5 })] });
  render(<UfcLeaderboardView board={b} scope={{ kind: "year", year: 2026 }} nextSlug={SLUG} />);
  expect(screen.getByRole("cell", { name: "IronJaw" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "2026" })).toHaveAttribute("aria-current", "page");
});

it("says when a card is not on the board", () => {
  render(<UfcLeaderboardView board={null} scope={{ kind: "card", slug: "no-such-card" }} nextSlug={SLUG} />);
  expect(screen.getByRole("heading", { name: "That card is not on the leaderboard" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Leaderboard" })).toHaveAttribute("href", "/ufc/leaderboard");
  expect(screen.queryByRole("table")).toBeNull();
});

it("switches between this card and the year with plain links", () => {
  const { unmount } = render(<UfcLeaderboardView board={FULL} scope={card} nextSlug={SLUG} />);
  const group = screen.getByRole("group", { name: "Show" });
  const thisCard = within(group).getByRole("link", { name: "This card" });
  expect(thisCard).toHaveAttribute("href", `/ufc/leaderboard?event=${SLUG}`);
  expect(thisCard).toHaveAttribute("aria-current", "page");
  const year = within(group).getByRole("link", { name: "2026" });
  expect(year).toHaveAttribute("href", "/ufc/leaderboard?view=year");
  expect(year).not.toHaveAttribute("aria-current");
  unmount();

  const b = board({ scope: "year", event: null, year: 2026 });
  render(<UfcLeaderboardView board={b} scope={{ kind: "year", year: 2026 }} nextSlug={SLUG} />);
  const g2 = screen.getByRole("group", { name: "Show" });
  expect(within(g2).getByRole("link", { name: "2026" })).toHaveAttribute("aria-current", "page");
  expect(within(g2).getByRole("link", { name: "This card" })).toHaveAttribute("href", `/ufc/leaderboard?event=${SLUG}`);
});

it("points the card link at the next card when the URL named none", () => {
  render(<UfcLeaderboardView board={FULL} scope={{ kind: "card", slug: null }} nextSlug="ufc-next-2027-01-09" />);
  expect(screen.getByRole("link", { name: "This card" })).toHaveAttribute("href", "/ufc/leaderboard?event=ufc-next-2027-01-09");
});

it("invites a signed-out visitor to sign in, and nobody else", async () => {
  const { unmount } = render(<UfcLeaderboardView board={FULL} scope={card} nextSlug={SLUG} />);
  fireEvent.click(screen.getByRole("button", { name: "Sign in to keep your picks across devices" }));
  expect(openSignIn).toHaveBeenCalled();
  unmount();
  (useAuth as jest.Mock).mockReturnValue({ user: { id: 1 }, loading: false, openSignIn });
  render(<UfcLeaderboardView board={FULL} scope={card} nextSlug={SLUG} />);
  expect(screen.queryByRole("button", { name: /sign in/i })).toBeNull();
});

it("does not ask for the viewer when storage is blocked, and survives a failed lookup", async () => {
  (getOrCreateDeviceId as jest.Mock).mockReturnValue(null);
  const { unmount } = render(<UfcLeaderboardView board={FULL} scope={card} nextSlug={SLUG} />);
  expect(getUfcPicksSummary).not.toHaveBeenCalled();
  unmount();
  (getOrCreateDeviceId as jest.Mock).mockReturnValue("dev-1");
  (getUfcPicksSummary as jest.Mock).mockRejectedValue(new Error("down"));
  render(<UfcLeaderboardView board={FULL} scope={card} nextSlug={SLUG} />);
  await waitFor(() => expect(getUfcPicksSummary).toHaveBeenCalled());
  expect(screen.getByRole("table")).toBeInTheDocument();
});

it("spells out the year in the link when it is not the current one", () => {
  const b = board({ event: { slug: "ufc-old-2025-03-01", name: "UFC Old", first_bout_utc: "2025-03-01T20:00:00Z" } });
  render(<UfcLeaderboardView board={b} scope={{ kind: "card", slug: "ufc-old-2025-03-01" }} nextSlug={SLUG} />);
  expect(screen.getByRole("link", { name: "2025" })).toHaveAttribute("href", "/ufc/leaderboard?view=year&year=2025");
});
