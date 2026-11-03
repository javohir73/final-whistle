/** H2: the fixtures page is ISR, so its HTML can be hours old when it
 *  hydrates. Day labels ("Today" / "Tomorrow") and live pinning read the
 *  clock; with the server's render instant passed in, the first client pass
 *  reads exactly what the server read, and the browser clock follows. */
import { getUpcomingMatches } from "@/lib/api";
import type { MatchSummary } from "@/lib/types";
import { hydrateAcrossTime } from "@/components/match/hydrate.testutil";
import { MatchesClient } from "./MatchesClient";

jest.mock("@/lib/api");
jest.mock("next/navigation", () => ({ usePathname: () => "/football/epl/fixtures" }));
const mockGet = getUpcomingMatches as jest.MockedFunction<typeof getUpcomingMatches>;

const fixture = (over: Partial<MatchSummary> = {}): MatchSummary => ({
  match_id: 7, stage: "group", group: null, kickoff_utc: "2026-11-08T15:00:00Z",
  venue: null, venue_city: null, venue_country: null, is_neutral: false,
  status: "scheduled", score_home: null, score_away: null, minute: null,
  period: null, injury_time: null, penalty_home: null, penalty_away: null,
  goal_events: [], teams: { home: "Arsenal", away: "Chelsea" },
  predicted_winner: "Arsenal", probabilities: { home_win: 0.5, draw: 0.27, away_win: 0.23 },
  predicted_score: { home: 1, away: 0, probability: 0.11 }, confidence: "Medium",
  ...over,
});

beforeEach(() => {
  window.localStorage.setItem("pp:timezone", JSON.stringify({ tz: "UTC", confirmed: true }));
  mockGet.mockReturnValue(new Promise(() => {})); // the poll never lands: keep the seed
});
afterEach(() => {
  jest.useRealTimers();
  jest.resetAllMocks();
  window.localStorage.clear();
  document.body.innerHTML = "";
});

it("rendered the evening before, hydrated the next morning: no Tomorrow/Today mismatch", async () => {
  const serverNow = "2026-11-07T22:00:00.000Z";
  jest.useFakeTimers({ now: new Date(serverNow) });
  const { html, container, errors } = await hydrateAcrossTime(
    () => <MatchesClient initialMatches={[fixture()]} competition="epl" renderedAt={serverNow} />,
    new Date(serverNow),
    new Date("2026-11-08T08:00:00Z"),
  );
  expect(html).toContain("Tomorrow · Sunday, 8 November 2026");
  expect(errors).toEqual([]);
  expect(container).toHaveTextContent("Today · Sunday, 8 November 2026");
});

it("rendered mid-match, hydrated after the live window: no LIVE/pending mismatch", async () => {
  const serverNow = "2026-11-08T17:50:00.000Z"; // 170 min after a 15:00 kickoff
  jest.useFakeTimers({ now: new Date(serverNow) });
  const stuck = fixture({ status: "in_play", score_home: 1, score_away: 0, minute: 90, period: "second_half" });
  const { html, errors, container } = await hydrateAcrossTime(
    () => <MatchesClient initialMatches={[stuck]} competition="epl" renderedAt={serverNow} />,
    new Date(serverNow),
    new Date("2026-11-08T18:30:00Z"),
  );
  expect(html).toContain("Live now"); // pinned when the server rendered it
  expect(errors).toEqual([]);
  // After hydration the browser clock retires the stranded LIVE pin: the row
  // is filed as a (pending) result, not left counting live.
  expect(container).not.toHaveTextContent("Live now");
  expect(container).not.toHaveTextContent("90' est.");
});

it("hydrates cleanly without a server instant too (no day label until the clock is known)", async () => {
  jest.useFakeTimers({ now: new Date("2026-11-07T22:00:00Z") });
  const { html, container, errors } = await hydrateAcrossTime(
    () => <MatchesClient initialMatches={[fixture()]} competition="epl" />,
    new Date("2026-11-07T22:00:00Z"),
    new Date("2026-11-08T08:00:00Z"),
  );
  expect(html).not.toContain("Tomorrow");
  expect(errors).toEqual([]);
  expect(container).toHaveTextContent("Today · Sunday, 8 November 2026");
});
