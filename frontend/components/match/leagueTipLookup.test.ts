/** Finding a match's matchweek in the league tips game without a matchweek on
 *  the match itself: remembered week first, then the current week, then a short
 *  kickoff-guided walk. */
import { getMyLeagueTips } from "@/lib/leagueTips";
import { ApiError } from "@/lib/session";
import type { LeagueTipsMineMatch, LeagueTipsMineResponse } from "@/lib/types";
import {
  findMyLeagueTip,
  LeagueTipsNotOpen,
  PICKER_CACHE_PREFIX,
  readMatchweekHint,
  writePickerCache,
} from "./leagueTipLookup";

jest.mock("@/lib/leagueTips");
const mockMine = getMyLeagueTips as jest.MockedFunction<typeof getMyLeagueTips>;

const DAY = 24 * 60 * 60_000;
const BASE = Date.parse("2026-11-08T15:00:00Z"); // matchweek 11 Saturday

function row(id: number, kickoffMs: number): LeagueTipsMineMatch {
  return {
    id, home: "Arsenal", away: "Chelsea", kickoff_utc: new Date(kickoffMs).toISOString(),
    status: "scheduled", score_home: null, score_away: null, model: null, your_prediction: null,
  };
}

/** Matchweek n: ids n*100+1..+3, Saturday/Sunday/Monday of week (n - 11) from BASE. */
function week(n: number): LeagueTipsMineResponse {
  const sat = BASE + (n - 11) * 7 * DAY;
  return {
    league: "epl", matchweek: n, handle: "SwiftStriker42",
    matches: [row(n * 100 + 1, sat), row(n * 100 + 2, sat + DAY), row(n * 100 + 3, sat + 2 * DAY)],
    disclaimer: "",
  };
}

function serveWeeks(current: number, max = 38) {
  mockMine.mockImplementation(async (_league, _device, matchweek) => {
    const n = matchweek ?? current;
    if (n < 1 || n > max) throw new ApiError(404, "matchweek_not_found", "No matches");
    return week(n);
  });
}

beforeEach(() => localStorage.clear());
afterEach(() => jest.resetAllMocks());

it("finds a current-week match with one request and remembers its week", async () => {
  serveWeeks(11);
  const found = await findMyLeagueTip("epl", "device-1", 1102, week(11).matches[1].kickoff_utc);
  expect(found.matchweek).toBe(11);
  expect(found.row?.id).toBe(1102);
  expect(found.handle).toBe("SwiftStriker42");
  expect(mockMine).toHaveBeenCalledTimes(1);
  expect(readMatchweekHint("epl", 1102)).toBe(11);
});

it("goes straight to a remembered matchweek", async () => {
  serveWeeks(11);
  await findMyLeagueTip("epl", "device-1", 1502, week(15).matches[1].kickoff_utc);
  mockMine.mockClear();
  const again = await findMyLeagueTip("epl", "device-1", 1502, week(15).matches[1].kickoff_utc);
  expect(again.matchweek).toBe(15);
  expect(mockMine).toHaveBeenCalledTimes(1);
  expect(mockMine).toHaveBeenCalledWith("epl", "device-1", 15);
});

it("uses the /play picker's per-matchweek cache as a hint", async () => {
  serveWeeks(11);
  writePickerCache("epl", 14, 1403, { predicted_home: 2, predicted_away: 1 });
  expect(localStorage.getItem(`${PICKER_CACHE_PREFIX}epl:14`)).not.toBeNull();
  const found = await findMyLeagueTip("epl", "device-1", 1403, week(14).matches[2].kickoff_utc);
  expect(found.matchweek).toBe(14);
  expect(mockMine).toHaveBeenCalledTimes(1);
});

it("walks forward by kickoff to a later matchweek", async () => {
  serveWeeks(11);
  const found = await findMyLeagueTip("epl", "device-1", 1601, week(16).matches[0].kickoff_utc);
  expect(found.matchweek).toBe(16);
  expect(mockMine.mock.calls.map((c) => c[2])).toEqual([undefined, 16]);
});

it("walks backward by kickoff to a played matchweek", async () => {
  serveWeeks(11);
  const found = await findMyLeagueTip("epl", "device-1", 302, week(3).matches[1].kickoff_utc);
  expect(found.matchweek).toBe(3);
  expect(found.row?.id).toBe(302);
});

it("gives up after the request budget instead of crawling the season", async () => {
  // Kickoff dates claim week 30 but the listed ids never match.
  serveWeeks(11);
  const found = await findMyLeagueTip("epl", "device-1", 999_999, week(30).matches[0].kickoff_utc, 3);
  expect(found).toEqual({ matchweek: null, row: null, handle: "SwiftStriker42" });
  expect(mockMine.mock.calls.length).toBeLessThanOrEqual(3);
});

it("stops when the match sits inside a week's dates but is not listed (rescheduled)", async () => {
  serveWeeks(11);
  const found = await findMyLeagueTip("epl", "device-1", 777, week(11).matches[1].kickoff_utc);
  expect(found.row).toBeNull();
  expect(mockMine).toHaveBeenCalledTimes(1);
});

it("reports a league with no tips data as not open", async () => {
  mockMine.mockRejectedValue(new ApiError(404, "no_matchweek_data", "No epl matchweeks are loaded yet"));
  await expect(findMyLeagueTip("epl", "device-1", 1, null)).rejects.toBeInstanceOf(LeagueTipsNotOpen);
});

it("rethrows a real failure so the page can offer a retry", async () => {
  mockMine.mockRejectedValue(new ApiError(503, "http_503", "Service unavailable"));
  await expect(findMyLeagueTip("epl", "device-1", 1, null)).rejects.toBeInstanceOf(ApiError);
});
