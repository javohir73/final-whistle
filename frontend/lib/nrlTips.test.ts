import {
  isNrlOffSeasonDate,
  isNrlOpenMatch,
  nrlReturnYear,
  nrlSeasonStart,
  nrlSeasonState,
  nrlStartLabel,
} from "./nrlTips";

const NOW = new Date("2026-11-03T00:00:00Z");
const day = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();
const minutes = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString();
const round = (...matches: { status: string; kickoff_utc: string | null }[]) => ({ matches });

it("is open while a round has something left to tip", () => {
  expect(
    nrlSeasonState([round({ status: "finished", kickoff_utc: day(-1) }, { status: "scheduled", kickoff_utc: day(1) })], NOW),
  ).toBe("open");
  expect(nrlSeasonState([round({ status: "in_play", kickoff_utc: minutes(-30) })], NOW)).toBe("open");
});

it("bounds an in_play row by the backend's live window (kickoff + 140 min)", () => {
  expect(isNrlOpenMatch({ status: "in_play", kickoff_utc: minutes(-139) }, NOW)).toBe(true);
  expect(isNrlOpenMatch({ status: "in_play", kickoff_utc: minutes(-141) }, NOW)).toBe(false);
  // A Grand Final stuck "in_play" a month later no longer keeps the season open.
  expect(nrlSeasonState([round({ status: "in_play", kickoff_utc: day(-30) })], NOW)).toBe("complete");
});

it("is complete once the Grand Final is decided, or weeks after the last kickoff", () => {
  expect(nrlSeasonState([round({ status: "finished", kickoff_utc: day(-30) })], NOW)).toBe("complete");
  expect(nrlSeasonState([round({ status: "finished", kickoff_utc: day(-1) })], NOW)).toBe("complete");
  expect(
    nrlSeasonState(
      [round({ status: "finished", kickoff_utc: day(-40) }, { status: "finished", kickoff_utc: day(-40) })],
      NOW,
    ),
  ).toBe("complete");
  // Across a whole draw, the decided final is the last round's single match.
  expect(
    nrlSeasonState(
      [
        round({ status: "finished", kickoff_utc: day(-38) }, { status: "finished", kickoff_utc: day(-37) }),
        round({ status: "finished", kickoff_utc: day(-30) }),
      ],
      NOW,
    ),
  ).toBe("complete");
});

it("is only between rounds in the days before the next draw lands", () => {
  expect(
    nrlSeasonState([round({ status: "finished", kickoff_utc: day(-3) }, { status: "finished", kickoff_utc: day(-2) })], NOW),
  ).toBe("between-rounds");
  // A ghost fixture still marked scheduled long after kickoff is nothing to tip.
  expect(
    nrlSeasonState([round({ status: "scheduled", kickoff_utc: day(-2) }, { status: "finished", kickoff_utc: day(-2) })], NOW),
  ).toBe("between-rounds");
});

it("is pre-season once next season's draw is loaded and its first kickoff is weeks away", () => {
  const draw = [
    round({ status: "scheduled", kickoff_utc: day(100) }, { status: "scheduled", kickoff_utc: day(101) }),
    round({ status: "scheduled", kickoff_utc: day(107) }),
  ];
  expect(nrlSeasonState(draw, NOW)).toBe("pre-season");
  expect(nrlSeasonStart(draw)).toBe(day(100));
  // Inside two weeks of the opener it is simply open (Round 1 is next up).
  expect(nrlSeasonState([round({ status: "scheduled", kickoff_utc: day(10) })], NOW)).toBe("open");
});

it("labels the season start in Sydney time", () => {
  expect(nrlStartLabel("2027-03-04T08:00:00Z")).toBe("Thursday 4 March");
  expect(nrlStartLabel("2027-03-04T08:00:00Z", "short")).toBe("Thu 4 Mar");
});

it("knows the off-season from the calendar alone (a fallback), never in Grand Final week", () => {
  expect(isNrlOffSeasonDate(new Date("2026-10-04T09:00:00Z"))).toBe(false); // GF day
  expect(isNrlOffSeasonDate(new Date("2026-10-08T09:00:00Z"))).toBe(true);
  expect(isNrlOffSeasonDate(new Date("2026-11-03T00:00:00Z"))).toBe(true);
  expect(isNrlOffSeasonDate(new Date("2027-02-15T00:00:00Z"))).toBe(true);
  expect(isNrlOffSeasonDate(new Date("2027-04-15T00:00:00Z"))).toBe(false);
  expect(nrlReturnYear(new Date("2026-11-03T00:00:00Z"))).toBe(2027);
  expect(nrlReturnYear(new Date("2027-02-15T00:00:00Z"))).toBe(2027);
});
