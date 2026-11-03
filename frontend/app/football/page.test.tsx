/** /football was a 404. It is now a server-rendered hub generated from the
 *  competition registry: live competitions first, WC26 under Past
 *  tournaments, each with its logo, season line and scoped links. */
import { render, screen, within } from "@testing-library/react";
import FootballHubPage, { metadata, revalidate } from "./page";
import { getCompetitionTournament } from "@/lib/tournament";
import type { ActiveTournament } from "@/lib/types";
import type { CompetitionId } from "@/lib/sports";

jest.mock("@/lib/tournament", () => ({ getCompetitionTournament: jest.fn() }));
const mockTournament = getCompetitionTournament as jest.MockedFunction<
  typeof getCompetitionTournament
>;

const NAMES: Partial<Record<CompetitionId, string>> = {
  epl: "Premier League 2026-27",
  laliga: "La Liga 2026-27",
  bundesliga: "Bundesliga 2026-27",
  ucl: "UEFA Champions League 2026-27",
  wc26: "FIFA World Cup 2026",
};

beforeEach(() => {
  mockTournament.mockImplementation(async (id: CompetitionId) => ({
    id: 1,
    name: NAMES[id] ?? id,
    year: 2026,
    format: id === "wc26" ? "knockout" : "league",
    has_brackets: id === "wc26",
  }));
});
afterEach(() => jest.clearAllMocks());

const renderHub = async () => render(await FootballHubPage());

it("lists the live football competitions with season lines and scoped links", async () => {
  await renderHub();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Choose a competition");
  const current = within(screen.getAllByRole("list")[0]);
  for (const [id, label] of [
    ["epl", "Premier League"],
    ["laliga", "La Liga"],
    ["bundesliga", "Bundesliga"],
    ["ucl", "UEFA Champions League"],
  ] as const) {
    // The card's main link (name + season line), not its fixtures/table links.
    expect(current.getByRole("link", { name: new RegExp(`^${label}\\s*2026`) })).toHaveAttribute(
      "href",
      `/football/${id}`,
    );
    expect(current.getByRole("link", { name: `${label} fixtures` })).toHaveAttribute(
      "href",
      `/football/${id}/fixtures`,
    );
    expect(current.getByRole("link", { name: `${label} table` })).toHaveAttribute(
      "href",
      `/football/${id}/standings`,
    );
  }
  expect(current.getAllByText("2026-27 season")).toHaveLength(4);
  // NRL is not football.
  expect(current.queryByText("NRL")).not.toBeInTheDocument();
});

it("files the World Cup under Past tournaments with its group tables", async () => {
  await renderHub();
  const past = screen.getByRole("heading", { name: "Past tournaments" }).nextElementSibling!;
  const wc = within(past as HTMLElement);
  expect(wc.getByRole("link", { name: /^World Cup 2026\s*Past/ })).toHaveAttribute(
    "href",
    "/football/wc26",
  );
  expect(wc.getByRole("link", { name: "World Cup 2026 groups" })).toHaveAttribute(
    "href",
    "/football/wc26/groups",
  );
  expect(wc.getByText("Past tournament · 2026")).toBeInTheDocument();
});

it("shows each competition's logo", async () => {
  const { container } = await renderHub();
  for (const id of ["epl", "laliga", "bundesliga", "ucl", "wc26"]) {
    expect(container.querySelector(`[data-competition-logo="${id}"]`)).not.toBeNull();
  }
});

it("says so honestly when a competition's season feed is not loaded", async () => {
  mockTournament.mockImplementation(async (id: CompetitionId) => ({
    id: id === "bundesliga" ? 0 : 1,
    name: NAMES[id] ?? id,
    year: 2026,
    format: "league",
    has_brackets: false,
  }) as ActiveTournament);
  await renderHub();
  expect(screen.getByText("Season details unavailable")).toBeInTheDocument();
});

it("links across to rugby league", async () => {
  await renderHub();
  expect(screen.getByRole("link", { name: /NRL/ })).toHaveAttribute("href", "/nrl");
});

it("is indexable with its own canonical, and ISR-cached", () => {
  expect(metadata.alternates?.canonical).toBe("/football");
  expect(metadata.robots).toBeUndefined();
  expect(revalidate).toBe(300);
});
