import { render, screen } from "@testing-library/react";
import UfcHomePage, { metadata } from "./page";
import { getUfcEventsServer, getUfcNextEventServer } from "@/lib/api";
import { UPCOMING_EVENT, UPCOMING_LIST } from "@/components/ufc/fixtures.testutil";
import { mockMine } from "@/components/ufc/BoutPick.fixtures.testutil";

// The card reads the viewer's picks after it mounts; these tests are about the server-rendered page.
jest.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: null, loading: false, openSignIn: jest.fn() }),
}));

jest.mock("@/lib/api");
const mockNext = getUfcNextEventServer as jest.MockedFunction<typeof getUfcNextEventServer>;
const mockList = getUfcEventsServer as jest.MockedFunction<typeof getUfcEventsServer>;

beforeEach(() => {
  mockMine("pending");
  mockNext.mockReset();
  mockList.mockReset();
  mockList.mockResolvedValue({ events: UPCOMING_LIST });
  window.localStorage.setItem("pp:timezone", JSON.stringify({ tz: "Australia/Sydney", confirmed: true }));
});

it("renders the next card", async () => {
  mockNext.mockResolvedValue(UPCOMING_EVENT);
  render(await UfcHomePage());
  expect(screen.getByRole("heading", { level: 1, name: UPCOMING_EVENT.name })).toBeInTheDocument();
});

it("still renders the card when the list fails", async () => {
  mockNext.mockResolvedValue(UPCOMING_EVENT);
  mockList.mockRejectedValue(new Error("502"));
  render(await UfcHomePage());
  expect(screen.getByRole("heading", { level: 1, name: UPCOMING_EVENT.name })).toBeInTheDocument();
  expect(screen.queryByText("Upcoming cards")).toBeNull();
});

it("says there are no cards yet", async () => {
  mockNext.mockResolvedValue(null);
  render(await UfcHomePage());
  expect(screen.getByText("No UFC cards yet")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Go to the home page" })).toHaveAttribute("href", "/");
});

it("says the feed is down", async () => {
  mockNext.mockRejectedValue(new Error("502"));
  render(await UfcHomePage());
  expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  expect(screen.getByText("Fight cards are unavailable right now")).toBeInTheDocument();
  expect(screen.getByText("We could not reach the fight feed. Try again in a minute.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "All cards" })).toHaveAttribute("href", "/ufc/events");
});

it("has honest metadata", () => {
  expect(metadata.title).toBe("UFC fight cards — FinalWhistle");
  expect(JSON.stringify(metadata)).not.toMatch(/result|record/i);
  expect(JSON.stringify(metadata)).not.toMatch(/official/i);
});
