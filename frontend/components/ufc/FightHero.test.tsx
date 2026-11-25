import { render, screen } from "@testing-library/react";
import { FightHero } from "./FightHero";
import { KO_BOUT, SCHEDULED_BOUT, UNKNOWN_TAPE_BOUT } from "./fixtures.testutil";
import type { UfcBoutDetail } from "@/lib/ufcTypes";

it("links both fighters and shows their records", () => {
  render(<FightHero bout={SCHEDULED_BOUT} tz="Australia/Sydney" />);
  expect(screen.getByRole("link", { name: /Israel Adesanya/ })).toHaveAttribute("href", "/ufc/fighter/israel-adesanya-4285679");
  expect(screen.getByRole("link", { name: /Shara Magomedov/ })).toHaveAttribute("href", "/ufc/fighter/shara-magomedov-4421784");
  expect(screen.getByText("24-6-0")).toBeInTheDocument();
  expect(screen.getByText("5:00 am")).toBeInTheDocument();
  expect(screen.getByText("Sun 6 Dec")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Israel Adesanya v Shara Magomedov" })).toBeInTheDocument();
  expect(screen.getByText("UFC · Sun 6 Dec · Main card")).toBeInTheDocument();
  expect(screen.getByText("Middleweight · 5 rounds")).toBeInTheDocument();
});

it("does not link a TBA fighter", () => {
  render(<FightHero bout={UNKNOWN_TAPE_BOUT} tz="UTC" />);
  expect(screen.getByText("TBA")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /TBA/ })).toBeNull();
  expect(screen.getByRole("link", { name: /Max Holloway/ })).toBeInTheDocument();
  expect(screen.getByText("?")).toBeInTheDocument();
});

it("prints the result line on a finished fight and marks the winner stored as b", () => {
  render(<FightHero bout={KO_BOUT} tz="UTC" />);
  expect(screen.getByText("KO R2")).toBeInTheDocument();
  expect(screen.getByText("Navajo Stirling won by KO/TKO (punch), round 2, 4:58")).toBeInTheDocument();
  const winners = screen.getAllByText("Winner");
  expect(winners).toHaveLength(1);
  const sideB = screen.getByRole("link", { name: /Navajo Stirling/ }).closest("[data-side]");
  expect(sideB).toHaveAttribute("data-side", "b");
  expect(sideB).toContainElement(winners[0]);
});

it("marks no winner on a draw", () => {
  const draw: UfcBoutDetail = {
    ...KO_BOUT,
    result: { winner: null, method: "draw", method_detail: "Majority", end_round: 3, end_clock: "5:00" },
  };
  render(<FightHero bout={draw} tz="UTC" />);
  expect(screen.getByText("DRAW")).toBeInTheDocument();
  expect(screen.queryByText("Winner")).toBeNull();
});

it("shows Live and Cancelled in the centre", () => {
  const { rerender } = render(<FightHero bout={{ ...SCHEDULED_BOUT, status: "live" }} tz="UTC" />);
  expect(screen.getByText("Live")).toBeInTheDocument();
  rerender(<FightHero bout={{ ...SCHEDULED_BOUT, status: "cancelled" }} tz="UTC" />);
  expect(screen.getByText("Cancelled")).toBeInTheDocument();
});

it("says TBC without a time and never prints null or undefined", () => {
  const { container } = render(<FightHero bout={{ ...SCHEDULED_BOUT, scheduled_utc: null, weight_class: null }} tz="UTC" />);
  expect(screen.getByText("TBC")).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/null|undefined|NaN/);
});

it("keeps long names wrapping", () => {
  const long: UfcBoutDetail = {
    ...SCHEDULED_BOUT,
    fighter_b: { ...SCHEDULED_BOUT.fighter_b, name: "Maximiliano Bartholomew Wolfeschlegelsteinhausen", slug: "wolfe-1" },
  };
  render(<FightHero bout={long} tz="UTC" />);
  const name = screen.getByText("Maximiliano Bartholomew Wolfeschlegelsteinhausen");
  expect(name.className).toContain("break-words");
  expect(name.closest(".min-w-0")).not.toBeNull();
});
