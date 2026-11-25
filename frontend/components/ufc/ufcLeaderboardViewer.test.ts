import { findViewerRow } from "./ufcLeaderboardViewer";
import type { UfcLeaderboardEntry, UfcPicksSummaryResponse } from "@/lib/ufcTypes";

const row = (o: Partial<UfcLeaderboardEntry> & { rank: number }): UfcLeaderboardEntry => ({
  handle: "SwiftStriker42", points: 9, winner_method: 1, graded: 4, is_model: false, ...o,
});
const totals = { picked: 4, graded: 4, points: 0, winner_method: 0 };
const summary = (o: Partial<UfcPicksSummaryResponse> = {}): UfcPicksSummaryResponse => ({
  handle: "SwiftStriker42",
  cards: [
    { slug: "card-a", name: "A", first_bout_utc: "2026-03-01T20:00:00Z", ...totals, points: 9, winner_method: 1 },
    { slug: "card-b", name: "B", first_bout_utc: "2026-11-01T20:00:00Z", ...totals, points: 5, winner_method: 1 },
    { slug: "card-old", name: "Old", first_bout_utc: "2025-12-31T23:59:00Z", ...totals, points: 7, winner_method: 0 },
    { slug: "card-none", name: "None", first_bout_utc: null, ...totals, points: 100, winner_method: 100 },
  ],
  totals,
  ...o,
});
const CARD = { kind: "card", slug: "card-a" } as const;

it("finds the one row with the viewer's handle and totals on a card board", () => {
  const mine = row({ rank: 2 });
  expect(findViewerRow([row({ rank: 1, handle: "Other", points: 12 }), mine], CARD, summary())).toBe(mine);
});

it("sums the summary's cards of that UTC year on a year board", () => {
  const mine = row({ rank: 1, points: 14, winner_method: 2 });
  expect(findViewerRow([mine], { kind: "year", year: 2026 }, summary())).toBe(mine);
  const old = row({ rank: 1, points: 7, winner_method: 0 });
  expect(findViewerRow([old], { kind: "year", year: 2025 }, summary())).toBe(old);
  expect(findViewerRow([row({ rank: 1, points: 9 })], { kind: "year", year: 2026 }, summary())).toBeNull();
});

it("never matches the model's row", () => {
  expect(findViewerRow([row({ rank: 1, is_model: true })], CARD, summary())).toBeNull();
});

it("picks the namesake whose totals equal the summary's", () => {
  const stranger = row({ rank: 1, points: 12, winner_method: 2 });
  const mine = row({ rank: 2 });
  expect(findViewerRow([stranger, mine], CARD, summary())).toBe(mine);
});

it("names nobody when two namesakes have identical totals", () => {
  expect(findViewerRow([row({ rank: 1 }), row({ rank: 2 })], CARD, summary())).toBeNull();
});

it("names nobody when the totals differ (a cached board and a fresher summary)", () => {
  expect(findViewerRow([row({ rank: 1, points: 8 })], CARD, summary())).toBeNull();
});

it("names nobody without a loaded summary, a handle, or that card or year", () => {
  const rows = [row({ rank: 1 })];
  expect(findViewerRow(rows, CARD, null)).toBeNull();
  expect(findViewerRow(rows, CARD, summary({ handle: null }))).toBeNull();
  expect(findViewerRow(rows, CARD, summary({ handle: "" }))).toBeNull();
  expect(findViewerRow(rows, { kind: "card", slug: "card-zzz" }, summary())).toBeNull();
  expect(findViewerRow(rows, { kind: "year", year: 2031 }, summary())).toBeNull();
  expect(findViewerRow(rows, CARD, summary({ cards: [] }))).toBeNull();
});
