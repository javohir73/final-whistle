import EventLayout from "./layout";
import { getUfcEventServer } from "@/lib/api";
import { UPCOMING_EVENT } from "@/components/ufc/fixtures.testutil";

jest.mock("@/lib/api");
const mockEvent = getUfcEventServer as jest.MockedFunction<typeof getUfcEventServer>;
const run = (slug: string) => EventLayout({ children: "kids", params: Promise.resolve({ slug }) });

beforeEach(() => mockEvent.mockReset());

it("404s an unknown slug before the page streams", async () => {
  mockEvent.mockResolvedValue(null);
  await expect(run("no-such-card")).rejects.toThrow();
});

it("404s a malformed slug without calling the API", async () => {
  await expect(run("../etc")).rejects.toThrow();
  expect(mockEvent).not.toHaveBeenCalled();
});

it("passes a known card through", async () => {
  mockEvent.mockResolvedValue(UPCOMING_EVENT);
  await expect(run(UPCOMING_EVENT.slug)).resolves.toBe("kids");
});

it("lets the page render when the fetch throws", async () => {
  mockEvent.mockRejectedValue(new Error("502"));
  await expect(run("ufc-300")).resolves.toBe("kids");
});
