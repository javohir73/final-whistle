import { boardHref, parseBoardScope } from "./scope";

const now = new Date("2026-12-05T00:00:00Z");
const YEAR = { kind: "year", year: 2026 };

it("opens on the current year with no parameters", () => {
  expect(parseBoardScope({}, now)).toEqual(YEAR);
});

it("parses the scope", () => {
  expect(parseBoardScope({ view: "year" }, now)).toEqual(YEAR);
  expect(parseBoardScope({ event: "ufc-fight-night-x-2026-12-05" }, now)).toEqual({ kind: "card", slug: "ufc-fight-night-x-2026-12-05" });
  expect(parseBoardScope({ event: "../x" }, now)).toEqual(YEAR);
  expect(parseBoardScope({ event: "" }, now)).toEqual(YEAR);
});

it("refuses a 300-character slug, which the API would refuse", () => {
  expect(parseBoardScope({ event: "a".repeat(300) }, now)).toEqual(YEAR);
  expect(parseBoardScope({ event: "a".repeat(220) }, now)).toEqual({ kind: "card", slug: "a".repeat(220) });
});

it("takes a valid year and falls back to the current one for a bad year", () => {
  expect(parseBoardScope({ view: "year", year: "2025" }, now)).toEqual({ kind: "year", year: 2025 });
  for (const bad of ["1999", "2101", "20x6", "", " 2025", "2025.0", "-2025", "99999", "２０２５", "٢٠٢٥", "2025\n"]) {
    expect(parseBoardScope({ view: "year", year: bad }, now)).toEqual(YEAR);
  }
});

it("ignores a year without view=year", () => {
  expect(parseBoardScope({ year: "2025" }, now)).toEqual(YEAR);
});

it("lets view=year win when both parameters are given", () => {
  expect(parseBoardScope({ view: "year", event: "ufc-300-2024-04-13" }, now)).toEqual(YEAR);
});

it("uses the UTC year, and takes the first of repeated parameters", () => {
  expect(parseBoardScope({ view: "year" }, new Date("2026-12-31T23:30:00Z"))).toEqual(YEAR);
  expect(parseBoardScope({ view: ["year", "card"], year: ["2024", "2025"] }, now)).toEqual({ kind: "year", year: 2024 });
  expect(parseBoardScope({ event: ["ufc-300-2024-04-13", "x"] }, now)).toEqual({ kind: "card", slug: "ufc-300-2024-04-13" });
  expect(parseBoardScope({ view: "other" }, now)).toEqual(YEAR);
});

it("clamps a machine clock outside the API's years", () => {
  expect(parseBoardScope({ view: "year" }, new Date("2150-01-01T00:00:00Z"))).toEqual({ kind: "year", year: 2100 });
});

it("builds links that always say which board", () => {
  expect(boardHref({ kind: "year", year: 2026 })).toBe("/ufc/leaderboard?view=year&year=2026");
  expect(boardHref({ kind: "card", slug: "ufc-x-2026-01-01" })).toBe("/ufc/leaderboard?event=ufc-x-2026-01-01");
});
