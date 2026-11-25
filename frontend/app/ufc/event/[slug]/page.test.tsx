import { render, screen } from "@testing-library/react";
import UfcEventPage, { generateMetadata, generateStaticParams } from "./page";
import { getUfcEventServer, getUfcEventsServer } from "@/lib/api";
import { FINISHED_EVENT, UPCOMING_EVENT } from "@/components/ufc/fixtures.testutil";
import { mockMine } from "@/components/ufc/BoutPick.fixtures.testutil";

// The card reads the viewer's picks after it mounts; these tests are about the server-rendered page.
jest.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: null, loading: false, openSignIn: jest.fn() }),
}));

jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
jest.mock("@/lib/api");
const mockEvent = getUfcEventServer as jest.MockedFunction<typeof getUfcEventServer>;
const mockList = getUfcEventsServer as jest.MockedFunction<typeof getUfcEventsServer>;
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  mockMine("pending");
  mockEvent.mockReset();
  mockList.mockReset();
  mockList.mockResolvedValue({ events: [] });
  window.localStorage.setItem("pp:timezone", JSON.stringify({ tz: "Australia/Sydney", confirmed: true }));
});

it("renders a finished card", async () => {
  mockEvent.mockResolvedValue(FINISHED_EVENT);
  render(await UfcEventPage(params(FINISHED_EVENT.slug)));
  expect(screen.getByRole("heading", { level: 1, name: FINISHED_EVENT.name })).toBeInTheDocument();
  expect(screen.getByText("KO R2")).toBeInTheDocument();
});

it("404s an unknown card", async () => {
  mockEvent.mockResolvedValue(null);
  await expect(UfcEventPage(params("no-such-card"))).rejects.toThrow("NEXT_NOT_FOUND");
});

it("says the feed is down", async () => {
  mockEvent.mockRejectedValue(new Error("502"));
  render(await UfcEventPage(params("ufc-300")));
  expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  expect(screen.getByText("This card is unavailable right now")).toBeInTheDocument();
});

it("prebuilds nothing", async () => {
  expect(await generateStaticParams()).toEqual([]);
});

describe("generateMetadata", () => {
  it("names the card and the main event", async () => {
    mockEvent.mockResolvedValue(FINISHED_EVENT);
    const m = await generateMetadata(params(FINISHED_EVENT.slug));
    expect(m.title).toBe(`${FINISHED_EVENT.name} — fight card and results | FinalWhistle`);
    expect(m.description).toBe(
      `${FINISHED_EVENT.main_event!.fighter_a.name} v ${FINISHED_EVENT.main_event!.fighter_b.name} and the full card: 4 fights, start times and results.`,
    );
    expect(JSON.stringify(m)).not.toMatch(/official/i);
  });
  it("drops the main event when there is none", async () => {
    mockEvent.mockResolvedValue({ ...UPCOMING_EVENT, main_event: null, bout_count: 7 });
    expect((await generateMetadata(params("x"))).description).toBe("The full card: 7 fights, start times and results.");
  });
  it("says how many fights, never '0 fights'", async () => {
    const g = async (e: object) => { mockEvent.mockResolvedValue({ ...UPCOMING_EVENT, ...e }); return (await generateMetadata(params("x"))).description; };
    expect(await g({ main_event: null, bout_count: 0 })).toBe("The card is still being announced.");
    expect(await g({ main_event: null, bout_count: 1 })).toBe("The full card: 1 fight, start times and results.");
    expect(await g({ bout_count: 0 })).toMatch(/The card is still being announced\.$/);
  });
  it("falls back for an unknown or malformed slug", async () => {
    mockEvent.mockResolvedValue(null);
    expect((await generateMetadata(params("nope"))).title).toBe("UFC card — FinalWhistle");
    expect((await generateMetadata(params("../etc"))).title).toBe("UFC card — FinalWhistle");
  });
});
