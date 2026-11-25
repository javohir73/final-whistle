import { parseBoardScope } from "./scope";

const now = new Date("2026-12-05T00:00:00Z");

it("parses the scope", () => {
  expect(parseBoardScope({ view: "year" }, now)).toEqual({ kind: "year", year: 2026 });
  expect(parseBoardScope({ event: "ufc-fight-night-x-2026-12-05" }, now)).toEqual({ kind: "card", slug: "ufc-fight-night-x-2026-12-05" });
  expect(parseBoardScope({ event: "../x" }, now)).toEqual({ kind: "card", slug: null });
  expect(parseBoardScope({}, now)).toEqual({ kind: "card", slug: null });
});

it("takes a valid year and falls back to the current one for a bad year", () => {
  expect(parseBoardScope({ view: "year", year: "2025" }, now)).toEqual({ kind: "year", year: 2025 });
  for (const bad of ["1999", "2101", "20x6", "", " 2025", "2025.0", "-2025", "99999"]) {
    expect(parseBoardScope({ view: "year", year: bad }, now)).toEqual({ kind: "year", year: 2026 });
  }
});

it("ignores a year without view=year", () => {
  expect(parseBoardScope({ year: "2025" }, now)).toEqual({ kind: "card", slug: null });
});

it("lets view=year win when both parameters are given", () => {
  expect(parseBoardScope({ view: "year", event: "ufc-300-2024-04-13" }, now)).toEqual({ kind: "year", year: 2026 });
});

it("uses the UTC year, and takes the first of repeated parameters", () => {
  expect(parseBoardScope({ view: "year" }, new Date("2026-12-31T23:30:00Z"))).toEqual({ kind: "year", year: 2026 });
  expect(parseBoardScope({ view: ["year", "card"], year: ["2024", "2025"] }, now)).toEqual({ kind: "year", year: 2024 });
  expect(parseBoardScope({ event: ["ufc-300-2024-04-13", "x"] }, now)).toEqual({ kind: "card", slug: "ufc-300-2024-04-13" });
  expect(parseBoardScope({ view: "other" }, now)).toEqual({ kind: "card", slug: null });
});

it("clamps a machine clock outside the API's years", () => {
  expect(parseBoardScope({ view: "year" }, new Date("2150-01-01T00:00:00Z"))).toEqual({ kind: "year", year: 2100 });
});
