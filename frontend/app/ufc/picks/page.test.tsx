import { render, screen } from "@testing-library/react";
import UfcPicksPage, { metadata, revalidate } from "./page";
import { getUfcNextEventServer } from "@/lib/api";
import { UPCOMING_EVENT } from "@/components/ufc/fixtures.testutil";

jest.mock("@/lib/api");
jest.mock("@/components/ufc/UfcMyPicksView", () => ({
  UfcMyPicksView: ({ event }: { event: { name: string } }) => <h1>view of {event.name}</h1>,
}));
const mockNext = getUfcNextEventServer as jest.MockedFunction<typeof getUfcNextEventServer>;

beforeEach(() => mockNext.mockReset());

it("renders the picks view for the next card", async () => {
  mockNext.mockResolvedValue(UPCOMING_EVENT);
  render(await UfcPicksPage());
  expect(screen.getByRole("heading", { level: 1, name: `view of ${UPCOMING_EVENT.name}` })).toBeInTheDocument();
});

it("shows the empty state when no card is loaded", async () => {
  mockNext.mockResolvedValue(null);
  render(await UfcPicksPage());
  expect(screen.getByRole("heading", { level: 1, name: "My picks" })).toBeInTheDocument();
  expect(screen.getByText("No UFC cards yet")).toBeInTheDocument();
  expect(screen.getByText("Picks open as soon as the next card is announced.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "All cards" })).toHaveAttribute("href", "/ufc/events");
});

it("shows the outage state when the feed fails", async () => {
  mockNext.mockRejectedValue(new Error("502"));
  render(await UfcPicksPage());
  expect(screen.getByRole("heading", { level: 1, name: "My picks" })).toBeInTheDocument();
  expect(screen.getByText("Picks are unavailable right now")).toBeInTheDocument();
  expect(screen.getByText("We could not reach the fight feed. Try again in a minute.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "All cards" })).toHaveAttribute("href", "/ufc/events");
});

it("never says official and carries the scoring copy in its description", () => {
  expect(metadata.title).toBe("My UFC picks — FinalWhistle");
  expect(metadata.description).toBe(
    "Pick the winner of every fight on the next UFC card, and how they win. Winner and method 5 points, winner 2.",
  );
  expect(JSON.stringify(metadata)).not.toMatch(/official/i);
  expect(revalidate).toBe(120);
});
