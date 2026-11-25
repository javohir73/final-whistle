import { SCHEDULED_BOUT } from "@/components/ufc/fixtures.testutil";
import { getUfcBoutServer } from "@/lib/api";
import FightLayout from "./layout";

jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
jest.mock("@/lib/api", () => ({ getUfcBoutServer: jest.fn() }));
const mockBout = getUfcBoutServer as jest.Mock;
beforeEach(() => mockBout.mockReset());

it("404s an unknown fight before the page streams", async () => {
  mockBout.mockResolvedValue(null);
  await expect(FightLayout({ children: null, params: Promise.resolve({ id: "999" }) })).rejects.toThrow("NEXT_NOT_FOUND");
});

it("404s a malformed id without calling the API", async () => {
  await expect(FightLayout({ children: null, params: Promise.resolve({ id: "abc" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  expect(mockBout).not.toHaveBeenCalled();
});

it("renders children for a known fight", async () => {
  mockBout.mockResolvedValue(SCHEDULED_BOUT);
  await expect(FightLayout({ children: "kids", params: Promise.resolve({ id: "1" }) })).resolves.toBe("kids");
});

it("lets the page render when the fetch fails", async () => {
  mockBout.mockRejectedValue(new Error("502"));
  await expect(FightLayout({ children: "kids", params: Promise.resolve({ id: "1" }) })).resolves.toBe("kids");
});
