import { isNrlOffSeasonDate, nrlReturnYear, nrlSeasonState } from "./nrlTips";

const NOW = new Date("2026-11-03T00:00:00Z");
const day = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

it("is open while a round has something left to tip", () => {
  expect(
    nrlSeasonState([{ status: "finished", kickoff_utc: day(-1) }, { status: "scheduled", kickoff_utc: day(1) }], NOW),
  ).toBe("open");
  expect(nrlSeasonState([{ status: "in_play", kickoff_utc: day(0) }], NOW)).toBe("open");
});

it("is complete once the Grand Final is decided, or weeks after the last kickoff", () => {
  expect(nrlSeasonState([{ status: "finished", kickoff_utc: day(-30) }], NOW)).toBe("complete");
  expect(nrlSeasonState([{ status: "finished", kickoff_utc: day(-1) }], NOW)).toBe("complete");
  expect(
    nrlSeasonState([{ status: "finished", kickoff_utc: day(-40) }, { status: "finished", kickoff_utc: day(-40) }], NOW),
  ).toBe("complete");
});

it("is only between rounds in the days before the next draw lands", () => {
  expect(
    nrlSeasonState([{ status: "finished", kickoff_utc: day(-3) }, { status: "finished", kickoff_utc: day(-2) }], NOW),
  ).toBe("between-rounds");
  // A ghost fixture still marked scheduled after kickoff is nothing to tip.
  expect(
    nrlSeasonState([{ status: "scheduled", kickoff_utc: day(-2) }, { status: "finished", kickoff_utc: day(-2) }], NOW),
  ).toBe("between-rounds");
});

it("knows the off-season from the calendar alone, and when the NRL is back", () => {
  expect(isNrlOffSeasonDate(new Date("2026-11-03T00:00:00Z"))).toBe(true);
  expect(isNrlOffSeasonDate(new Date("2027-02-15T00:00:00Z"))).toBe(true);
  expect(isNrlOffSeasonDate(new Date("2027-04-15T00:00:00Z"))).toBe(false);
  expect(nrlReturnYear(new Date("2026-11-03T00:00:00Z"))).toBe(2027);
  expect(nrlReturnYear(new Date("2027-02-15T00:00:00Z"))).toBe(2027);
});
