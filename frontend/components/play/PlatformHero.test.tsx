/** PlatformHero: the home page's first screen names the game for the
 *  visitor's competition (the nav's scope), sends "Make your picks" there,
 *  and carries the Next-up strip right under the CTAs. */
import { render, screen } from "@testing-library/react";
import { PlatformHero, heroCopy } from "./PlatformHero";
import type { CompetitionScope } from "@/components/TournamentProvider";

const mockScope = jest.fn<CompetitionScope, []>();
jest.mock("@/components/TournamentProvider", () => ({
  ...jest.requireActual("@/components/TournamentProvider"),
  useCompetitionScope: () => mockScope(),
}));
jest.mock("@/components/play/NextUpStrip", () => ({
  NextUpStrip: ({ competition }: { competition: string }) => (
    <section data-testid="next-up" data-competition={competition} />
  ),
}));

const NOVEMBER = new Date("2026-11-03T09:00:00Z"); // NRL off-season
const MAY = new Date("2027-05-10T09:00:00Z"); // NRL in season

function renderAs(competition: CompetitionScope["competition"], now = NOVEMBER) {
  mockScope.mockReturnValue({ competition, fromUrl: false });
  return render(<PlatformHero now={now} />);
}

afterEach(() => mockScope.mockReset());

it("names the visitor's league and sends 'Make your picks' straight to it", () => {
  renderAs("laliga");

  expect(screen.getByRole("heading", { level: 1, name: "Beat the model at La Liga." })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Make your picks/ })).toHaveAttribute("href", "/play?competition=laliga");
  expect(screen.getByTestId("next-up")).toHaveAttribute("data-competition", "laliga");
});

it("defaults to the Premier League wording", () => {
  renderAs("epl");
  expect(screen.getByRole("heading", { level: 1, name: "Beat the model at the Premier League." })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Make your picks/ })).toHaveAttribute("href", "/play?competition=epl");
});

it("says the NRL in season, with the EPL's fixtures in the football strip", () => {
  renderAs("nrl", MAY);
  expect(screen.getByRole("heading", { level: 1, name: "Beat the model at the NRL." })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Make your picks/ })).toHaveAttribute("href", "/play?competition=nrl");
  expect(screen.getByTestId("next-up")).toHaveAttribute("data-competition", "epl");
});

it.each(["nrl", "ucl", "wc26"] as const)(
  "falls back to 'Beat the model.' when %s has no picks open (off-season, not live, or past)",
  (competition) => {
    renderAs(competition);
    expect(screen.getByRole("heading", { level: 1, name: "Beat the model." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Make your picks/ })).toHaveAttribute("href", "/play?competition=epl");
  },
);

it("has the new subhead, a secondary 'Choose a competition', no checklist, and the strip under the CTAs", () => {
  renderAs("epl");

  expect(
    screen.getByText("Pick the scores before kickoff. Then see where you stand against the model."),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Choose a competition" })).toHaveAttribute("href", "#competitions");
  expect(screen.queryByText("Match probabilities")).not.toBeInTheDocument();
  expect(screen.queryByText("Your matchday,")).not.toBeInTheDocument();

  const secondary = screen.getByRole("link", { name: "Choose a competition" });
  const strip = screen.getByTestId("next-up");
  expect(secondary.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(strip.closest("section")?.parentElement?.closest("section")).toBe(
    screen.getByRole("heading", { level: 1 }).closest("section"),
  );
});

it("never promises a competition it can't resolve", () => {
  expect(heroCopy(null, NOVEMBER)).toEqual({ headline: "Beat the model.", playHref: "/play?competition=epl", nextUp: "epl" });
  expect(heroCopy("bundesliga", NOVEMBER).headline).toBe("Beat the model at the Bundesliga.");
});

it("lets the NRL's current round, not the calendar, decide whether NRL picks are open", () => {
  mockScope.mockReturnValue({ competition: "nrl", fromUrl: false });
  const { rerender } = render(<PlatformHero now={NOVEMBER} nrlPlayable />);
  expect(screen.getByRole("heading", { level: 1, name: "Beat the model at the NRL." })).toBeInTheDocument();

  rerender(<PlatformHero now={MAY} nrlPlayable={false} />);
  expect(screen.getByRole("heading", { level: 1, name: "Beat the model." })).toBeInTheDocument();
});
