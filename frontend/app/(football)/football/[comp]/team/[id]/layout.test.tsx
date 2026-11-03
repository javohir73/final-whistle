/** A wrong-competition (or unknown) team id under /football/{comp}/team/ must
 *  be a REAL 404, decided in the segment layout before team/[id]/loading.tsx
 *  starts streaming (a page-level notFound() there was a soft 404). */
import { notFound } from "next/navigation";
import { getTeamServer } from "@/lib/api";
import type { TeamProfile } from "@/lib/types";
import CompTeamLayout from "./layout";

jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
jest.mock("@/lib/api", () => ({ getTeamServer: jest.fn() }));

const mockTeam = getTeamServer as jest.MockedFunction<typeof getTeamServer>;

const layout = (comp: string, id: string) =>
  CompTeamLayout({ children: "team page", params: Promise.resolve({ comp, id }) });

afterEach(() => jest.clearAllMocks());

it("renders the page for a team in this competition", async () => {
  mockTeam.mockResolvedValue({ team: { id: 7 } } as TeamProfile);
  await expect(layout("laliga", "7")).resolves.toBe("team page");
  expect(mockTeam).toHaveBeenCalledWith("7", "laliga");
});

it("404s a team the backend says is not in this competition", async () => {
  mockTeam.mockResolvedValue(null);
  await expect(layout("wc26", "7")).rejects.toThrow("NEXT_NOT_FOUND");
});

it("does not turn a backend error into a 404 (the page decides)", async () => {
  mockTeam.mockRejectedValue(new Error("API 500"));
  await expect(layout("epl", "7")).resolves.toBe("team page");
  expect(notFound).not.toHaveBeenCalled();
});

it.each(["nrl", "bogus"])("404s an unwired competition segment (%s) without a fetch", async (comp) => {
  await expect(layout(comp, "7")).rejects.toThrow("NEXT_NOT_FOUND");
  expect(mockTeam).not.toHaveBeenCalled();
});

it("404s a non-numeric id without a fetch", async () => {
  await expect(layout("epl", "Argentina")).rejects.toThrow("NEXT_NOT_FOUND");
  expect(mockTeam).not.toHaveBeenCalled();
});
