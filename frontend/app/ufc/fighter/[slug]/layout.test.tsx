/** /ufc/fighter/{slug} must be a REAL 404 for an unknown or malformed slug,
 *  decided in the layout before loading.tsx streams. A transient backend error
 *  is the page's call, never a 404. */
import { notFound } from "next/navigation";
import { getUfcFighterServer } from "@/lib/api";
import { FIGHTER } from "@/components/ufc/fixtures.testutil";
import FighterLayout from "./layout";

jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
jest.mock("@/lib/api", () => ({ getUfcFighterServer: jest.fn() }));

const mockFighter = getUfcFighterServer as jest.MockedFunction<typeof getUfcFighterServer>;
const layout = (slug: string) => FighterLayout({ children: "fighter page", params: Promise.resolve({ slug }) });

afterEach(() => jest.clearAllMocks());

it("renders a known fighter", async () => {
  mockFighter.mockResolvedValue(FIGHTER);
  await expect(layout("jiri-prochazka-3156612")).resolves.toBe("fighter page");
  expect(mockFighter).toHaveBeenCalledWith("jiri-prochazka-3156612");
});

it("404s an unknown slug", async () => {
  mockFighter.mockResolvedValue(null);
  await expect(layout("no-such-fighter")).rejects.toThrow("NEXT_NOT_FOUND");
});

it.each(["Bad Slug!", "../etc", "Mateusz-Rębecki", "a".repeat(141)])("404s %p without calling the API", async (slug) => {
  await expect(layout(slug)).rejects.toThrow("NEXT_NOT_FOUND");
  expect(mockFighter).not.toHaveBeenCalled();
});

it("404s a slug the API rejects with a 4xx", async () => {
  mockFighter.mockRejectedValue(new Error("API /api/ufc/fighters/x failed: 422"));
  await expect(layout("x")).rejects.toThrow("NEXT_NOT_FOUND");
});

it("lets the page decide when the backend errors", async () => {
  mockFighter.mockRejectedValue(new Error("API /api/ufc/fighters/x failed: 503"));
  await expect(layout("mateusz-rebecki")).resolves.toBe("fighter page");
  expect(notFound).not.toHaveBeenCalled();
});
