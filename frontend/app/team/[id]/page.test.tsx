/** /team/:id is a competition lookup: 308 to the team's own
 *  /football/{comp}/team/:id instead of the old static WC26 redirect. */
import { notFound, permanentRedirect } from "next/navigation";
import { headers } from "next/headers";
import { getTeamServer } from "@/lib/api";
import type { TeamProfile } from "@/lib/types";
import LegacyTeamLookupPage, { metadata } from "./page";
import LegacyTeamLookupLayout from "./layout";

jest.mock("next/headers", () => ({ headers: jest.fn(), cookies: jest.fn() }));
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  permanentRedirect: jest.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT 308 ${url}`);
  }),
}));
jest.mock("@/lib/api", () => ({ getMatchSummaryServer: jest.fn(), getTeamServer: jest.fn() }));

const mockTeam = getTeamServer as jest.MockedFunction<typeof getTeamServer>;
const mockHeaders = headers as jest.MockedFunction<typeof headers>;

const profile = (competition?: string) =>
  ({ team: { id: 7, name: "Arsenal" }, competition }) as unknown as TeamProfile;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  mockHeaders.mockResolvedValue(new Headers() as unknown as Awaited<ReturnType<typeof headers>>);
});
afterEach(() => jest.clearAllMocks());

it("308s a club to its own competition", async () => {
  mockTeam.mockResolvedValue(profile("epl"));
  await expect(LegacyTeamLookupLayout({ children: null, ...params("7") })).rejects.toThrow(
    "NEXT_REDIRECT 308 /football/epl/team/7",
  );
  expect(permanentRedirect).toHaveBeenCalledTimes(1);
});

it("keeps national teams on the World Cup archive", async () => {
  mockTeam.mockResolvedValue(profile("wc26"));
  await expect(LegacyTeamLookupPage(params("10"))).rejects.toThrow(
    "NEXT_REDIRECT 308 /football/wc26/team/10",
  );
});

it("falls back to the WC26 path when the backend can't say", async () => {
  mockTeam.mockResolvedValue(profile(undefined));
  await expect(LegacyTeamLookupPage(params("10"))).rejects.toThrow(
    "NEXT_REDIRECT 308 /football/wc26/team/10",
  );
  mockTeam.mockRejectedValue(new Error("API 500"));
  await expect(LegacyTeamLookupPage(params("10"))).rejects.toThrow(
    "NEXT_REDIRECT 308 /football/wc26/team/10",
  );
});

it("is a real 404 for a missing or non-numeric team", async () => {
  mockTeam.mockResolvedValue(null);
  await expect(LegacyTeamLookupLayout({ children: null, ...params("7") })).rejects.toThrow(
    "NEXT_NOT_FOUND",
  );
  await expect(LegacyTeamLookupPage(params("Argentina"))).rejects.toThrow("NEXT_NOT_FOUND");
  expect(notFound).toHaveBeenCalledTimes(2);
});

it("is never indexed", () => {
  expect(metadata.robots).toEqual({ index: false, follow: true });
});
