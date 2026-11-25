import { notFound } from "next/navigation";
import { render, screen } from "@testing-library/react";
import { getUfcFighterServer } from "@/lib/api";
import { FIGHTER, FIGHTER_NO_HISTORY } from "@/components/ufc/fixtures.testutil";
import FighterPage, { generateMetadata, generateStaticParams, revalidate } from "./page";

jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
jest.mock("@/lib/api", () => ({ getUfcFighterServer: jest.fn() }));

const mockFighter = getUfcFighterServer as jest.MockedFunction<typeof getUfcFighterServer>;
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

afterEach(() => jest.clearAllMocks());

it("renders the fighter", async () => {
  mockFighter.mockResolvedValue(FIGHTER);
  render(await FighterPage(params("jiri-prochazka-3156612")));
  expect(screen.getByRole("heading", { level: 1, name: "Jiří Procházka" })).toBeInTheDocument();
});

it("404s a missing fighter and a malformed slug", async () => {
  mockFighter.mockResolvedValue(null);
  await expect(FighterPage(params("nobody"))).rejects.toThrow("NEXT_NOT_FOUND");
  mockFighter.mockClear();
  await expect(FighterPage(params("Bad Slug!"))).rejects.toThrow("NEXT_NOT_FOUND");
  expect(mockFighter).not.toHaveBeenCalled();
  expect(notFound).toHaveBeenCalledTimes(2);
});

it("says the feed is unavailable when the fetch throws", async () => {
  mockFighter.mockRejectedValue(new Error("502"));
  render(await FighterPage(params("mateusz-rebecki")));
  expect(screen.getByText("This fighter is unavailable right now")).toBeInTheDocument();
  expect(screen.getByText("We could not reach the fighter feed. Try again in a minute.")).toBeInTheDocument();
});

it("revalidates every five minutes and prebuilds nothing", async () => {
  expect(revalidate).toBe(300);
  expect(await generateStaticParams()).toEqual([]);
});

describe("metadata", () => {
  it("names the record when there is one", async () => {
    mockFighter.mockResolvedValue(FIGHTER);
    const m = await generateMetadata(params("jiri-prochazka-3156612"));
    expect(m.title).toBe("Jiří Procházka — UFC record and fights | FinalWhistle");
    expect(m.description).toBe(
      "Jiří Procházka's UFC record (1-1-0) and every fight we hold, with results and fight stats.",
    );
    expect(JSON.stringify(m)).not.toMatch(/official/i);
  });

  it("falls back when there is no record", async () => {
    mockFighter.mockResolvedValue(FIGHTER_NO_HISTORY);
    const m = await generateMetadata(params("shara-magomedov-4421784"));
    expect(m.description).toBe("Shara Magomedov: UFC fights and fighter facts.");
    expect(JSON.stringify(m)).not.toMatch(/No UFC fights|record/i);
  });

  it("is generic for an unknown, malformed or unreachable fighter", async () => {
    mockFighter.mockResolvedValue(null);
    expect((await generateMetadata(params("nobody"))).title).toBe("UFC fighter — FinalWhistle");
    mockFighter.mockRejectedValue(new Error("502"));
    expect((await generateMetadata(params("nobody"))).title).toBe("UFC fighter — FinalWhistle");
    mockFighter.mockClear();
    expect((await generateMetadata(params("Bad Slug!"))).title).toBe("UFC fighter — FinalWhistle");
    expect(mockFighter).not.toHaveBeenCalled();
  });
});
