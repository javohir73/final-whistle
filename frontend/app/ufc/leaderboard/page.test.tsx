import { render, screen } from "@testing-library/react";
import UfcLeaderboardPage, { metadata } from "./page";
import { getUfcLeaderboardServer, getUfcNextEventServer } from "@/lib/api";
import type { UfcLeaderboardResponse } from "@/lib/ufcTypes";

jest.mock("@/lib/api", () => ({ getUfcLeaderboardServer: jest.fn(), getUfcNextEventServer: jest.fn() }));
jest.mock("@/components/ufc/UfcLeaderboardView", () => ({
  UfcLeaderboardView: (p: { board: unknown; scope: unknown; nextSlug: unknown }) => (
    <div data-testid="view">{JSON.stringify(p)}</div>
  ),
}));

const next = getUfcNextEventServer as jest.Mock;
const lb = getUfcLeaderboardServer as jest.Mock;
const BOARD = { scope: "card", event: null, year: null, participant_count: 0, entries: [] } as UfcLeaderboardResponse;
const sp = (o: Record<string, string | string[]>) => Promise.resolve(o);
const shown = () => JSON.parse(screen.getByTestId("view").textContent ?? "");

beforeEach(() => {
  next.mockResolvedValue({ slug: "ufc-next-2026-12-05" });
  lb.mockResolvedValue(BOARD);
});
afterEach(() => jest.clearAllMocks());

const YEAR = new Date().getUTCFullYear();

it("opens on the current year's board by default", async () => {
  render(await UfcLeaderboardPage({ searchParams: sp({}) }));
  expect(lb).toHaveBeenCalledTimes(1);
  expect(lb).toHaveBeenCalledWith({ year: YEAR });
  expect(shown()).toMatchObject({ scope: { kind: "year", year: YEAR }, nextSlug: "ufc-next-2026-12-05", currentYear: YEAR });
});

it("fetches the year board for ?view=year", async () => {
  render(await UfcLeaderboardPage({ searchParams: sp({ view: "year", year: "2025" }) }));
  expect(lb).toHaveBeenCalledWith({ year: 2025 });
  expect(shown().scope).toEqual({ kind: "year", year: 2025 });
});

it("never sends a bad year or both parameters to the API", async () => {
  render(await UfcLeaderboardPage({ searchParams: sp({ view: "year", year: "1850", event: "ufc-x-2026-01-01" }) }));
  const arg = lb.mock.calls[0][0];
  expect(arg).toEqual({ year: YEAR });
});

it("asks for the card named in the URL, and passes a missing card on", async () => {
  lb.mockResolvedValue(null);
  render(await UfcLeaderboardPage({ searchParams: sp({ event: "no-such-card" }) }));
  expect(lb).toHaveBeenCalledWith({ event: "no-such-card" });
  expect(shown()).toMatchObject({ board: null, scope: { kind: "card", slug: "no-such-card" } });
});

it("falls back to the year for a malformed or over-long card slug", async () => {
  render(await UfcLeaderboardPage({ searchParams: sp({ event: "../etc/passwd" }) }));
  expect(lb).toHaveBeenLastCalledWith({ year: YEAR });
  render(await UfcLeaderboardPage({ searchParams: sp({ event: "a".repeat(300) }) }));
  expect(lb).toHaveBeenLastCalledWith({ year: YEAR });
});

it("shows the year board with no switch to a card when there is no upcoming card", async () => {
  next.mockResolvedValue(null);
  render(await UfcLeaderboardPage({ searchParams: sp({}) }));
  expect(lb).toHaveBeenCalledWith({ year: YEAR });
  expect(shown()).toMatchObject({ scope: { kind: "year", year: YEAR }, nextSlug: null });
});

it("shows a readable state with a way out when the board cannot be fetched", async () => {
  lb.mockRejectedValue(new Error("API failed: 500"));
  render(await UfcLeaderboardPage({ searchParams: sp({ event: "ufc-x-2026-01-01" }) }));
  expect(screen.getByRole("heading", { level: 1, name: "Leaderboard" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "The leaderboard is not available right now" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/ufc/leaderboard?event=ufc-x-2026-01-01");
  expect(screen.getByRole("link", { name: "See the fight cards" })).toHaveAttribute("href", "/ufc");
});

it("still shows the board when the next card cannot be found out", async () => {
  next.mockRejectedValue(new Error("down"));
  render(await UfcLeaderboardPage({ searchParams: sp({}) }));
  expect(shown()).toMatchObject({ scope: { kind: "year", year: YEAR }, nextSlug: null });
});

it("has metadata without the word official", () => {
  expect(String(metadata.title)).toBe("UFC leaderboard — FinalWhistle");
  expect(String(metadata.description)).toBe(
    "Players ranked by their UFC picks, card by card and across the year. Winner and method 5 points, winner 2.",
  );
  expect(JSON.stringify(metadata)).not.toMatch(/official/i);
});
