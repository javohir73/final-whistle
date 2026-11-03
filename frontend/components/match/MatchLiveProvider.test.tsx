/** MatchLiveProvider: the football match page's one polled summary, shared by
 *  the hero and the pick so pickability flips at kickoff without a reload. */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { getMatchSummary } from "@/lib/api";
import type { MatchSummary } from "@/lib/types";
import { MatchLiveProvider, useMatchLive, withinPollWindow } from "./MatchLiveProvider";

jest.mock("@/lib/api");
const mockSummary = getMatchSummary as jest.MockedFunction<typeof getMatchSummary>;

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

function summary(over: Partial<MatchSummary> = {}): MatchSummary {
  return {
    match_id: 5, stage: "group", group: null, kickoff_utc: inMinutes(5),
    venue: null, venue_city: null, venue_country: null, is_neutral: false,
    status: "scheduled", score_home: null, score_away: null, minute: null,
    period: null, injury_time: null, penalty_home: null, penalty_away: null,
    goal_events: [], teams: { home: "Arsenal", away: "Chelsea" },
    predicted_winner: null, probabilities: null, predicted_score: null, confidence: null,
    ...over,
  };
}

function Probe() {
  const live = useMatchLive();
  if (!live) return <span>no provider</span>;
  return (
    <>
      <span>
        {live.loading ? "loading" : live.error ? "error" : live.summary?.status ?? "none"}
      </span>
      <span data-testid="now">{live.now.getTime()}</span>
      <button type="button" onClick={live.refresh}>refresh</button>
    </>
  );
}

afterEach(() => {
  jest.useRealTimers();
  jest.resetAllMocks();
});

it("returns null outside a provider", () => {
  render(<Probe />);
  expect(screen.getByText("no provider")).toBeInTheDocument();
});

it("bounds polling to the match window", () => {
  const ko = Date.parse("2026-11-08T15:00:00Z");
  expect(withinPollWindow("2026-11-08T15:00:00Z", ko - 11 * 60_000)).toBe(false);
  expect(withinPollWindow("2026-11-08T15:00:00Z", ko - 9 * 60_000)).toBe(true);
  expect(withinPollWindow("2026-11-08T15:00:00Z", ko + 200 * 60_000)).toBe(true);
  expect(withinPollWindow("2026-11-08T15:00:00Z", ko + 300 * 60_000)).toBe(false);
  expect(withinPollWindow(null, ko)).toBe(true);
});

it("flips the shared status at kickoff from the poll, without a reload", async () => {
  jest.useFakeTimers();
  mockSummary
    .mockResolvedValueOnce(summary()) // mount refresh inside the window
    .mockResolvedValueOnce(summary({ status: "in_play", minute: 1, period: "first_half" }));

  render(
    <MatchLiveProvider matchId={5} competition="epl" initialSummary={summary()}>
      <Probe />
    </MatchLiveProvider>,
  );
  expect(screen.getByText("scheduled")).toBeInTheDocument();
  await act(async () => {});

  await act(async () => { jest.advanceTimersByTime(30_000); });
  expect(screen.getByText("in_play")).toBeInTheDocument();
  expect(mockSummary).toHaveBeenCalledWith(5, "epl");
});

it("ticks the shared clock every 30 s even when it does not fetch", async () => {
  jest.useFakeTimers();
  const farOff = summary({ kickoff_utc: inMinutes(5 * 24 * 60) });
  render(
    <MatchLiveProvider matchId={5} initialSummary={farOff}>
      <Probe />
    </MatchLiveProvider>,
  );
  const before = Number(screen.getByTestId("now").textContent);
  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(Number(screen.getByTestId("now").textContent)).toBeGreaterThan(before);
  // Days before kickoff: no HTTP at all, the seed is current.
  expect(mockSummary).not.toHaveBeenCalled();
});

it("fetches when the server seed is missing, surfaces a failure, and recovers on refresh", async () => {
  mockSummary
    .mockRejectedValueOnce(new Error("cold start"))
    .mockResolvedValueOnce(summary());

  render(
    <MatchLiveProvider matchId={5} initialSummary={null}>
      <Probe />
    </MatchLiveProvider>,
  );
  expect(screen.getByText("loading")).toBeInTheDocument();
  expect(await screen.findByText("error")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "refresh" }));
  expect(await screen.findByText("scheduled")).toBeInTheDocument();
});

it("never polls a finished match", async () => {
  jest.useFakeTimers();
  render(
    <MatchLiveProvider
      matchId={5}
      initialSummary={summary({ status: "finished", kickoff_utc: inMinutes(-60), score_home: 1, score_away: 0 })}
    >
      <Probe />
    </MatchLiveProvider>,
  );
  await act(async () => { jest.advanceTimersByTime(120_000); });
  expect(mockSummary).not.toHaveBeenCalled();
  expect(screen.getByText("finished")).toBeInTheDocument();
});

// --- H1: ISR pages can be hours old ---------------------------------------
// The match route is ISR, so the seed can predate kickoff by hours. The first
// client fetch must not be limited to the poll window, or a page cached before
// kickoff and opened the next morning says RESULT PENDING forever.

const KO = "2026-11-08T15:00:00+00:00";

it("re-asks once on mount for a pre-kickoff seed opened the next morning", async () => {
  jest.useFakeTimers({ now: new Date("2026-11-09T09:00:00Z") });
  mockSummary.mockResolvedValue(summary({ kickoff_utc: KO, status: "finished", score_home: 2, score_away: 1 }));
  render(
    <MatchLiveProvider matchId={5} competition="epl" kickoffUtc={KO} initialSummary={summary({ kickoff_utc: KO })}>
      <Probe />
    </MatchLiveProvider>,
  );
  await act(async () => {});
  expect(mockSummary).toHaveBeenCalledTimes(1);
  expect(screen.getByText("finished")).toBeInTheDocument();

  // Still outside the poll window afterwards: no interval traffic.
  await act(async () => { jest.advanceTimersByTime(10 * 60_000); });
  expect(mockSummary).toHaveBeenCalledTimes(1);
});

it("re-asks once on mount for a seed cached mid-match", async () => {
  jest.useFakeTimers({ now: new Date("2026-11-09T09:00:00Z") });
  mockSummary.mockResolvedValue(summary({ kickoff_utc: KO, status: "finished", score_home: 2, score_away: 1 }));
  render(
    <MatchLiveProvider
      matchId={5}
      kickoffUtc={KO}
      initialSummary={summary({ kickoff_utc: KO, status: "in_play", score_home: 1, score_away: 0, minute: 40 })}
    >
      <Probe />
    </MatchLiveProvider>,
  );
  await act(async () => {});
  expect(mockSummary).toHaveBeenCalledTimes(1);
  expect(screen.getByText("finished")).toBeInTheDocument();
});

it("keeps the stale seed (silently) when that mount fetch fails", async () => {
  jest.useFakeTimers({ now: new Date("2026-11-09T09:00:00Z") });
  mockSummary.mockRejectedValue(new Error("cold start"));
  render(
    <MatchLiveProvider matchId={5} kickoffUtc={KO} initialSummary={summary({ kickoff_utc: KO })}>
      <Probe />
    </MatchLiveProvider>,
  );
  await act(async () => {});
  expect(screen.getByText("scheduled")).toBeInTheDocument();
});

// --- H2: the first client pass reads the server's clock -------------------

it("renders with the server's render instant while hydrating, then the browser clock", async () => {
  const { hydrateAcrossTime } = await import("./hydrate.testutil");
  jest.useFakeTimers({ now: new Date("2026-11-08T14:59:00Z") });
  const serverNow = "2026-11-08T14:59:00.000Z";
  mockSummary.mockReturnValue(new Promise(() => {}));
  const { html, container, errors } = await hydrateAcrossTime(
    () => (
      <MatchLiveProvider matchId={5} kickoffUtc={KO} initialSummary={summary({ kickoff_utc: KO })} serverNow={serverNow}>
        <span data-testid="clock">
          <ClockOnly />
        </span>
      </MatchLiveProvider>
    ),
    new Date(serverNow),
    new Date("2026-11-08T15:01:00Z"),
  );
  expect(html).toContain(String(Date.parse(serverNow)));
  expect(errors).toEqual([]);
  expect(container).toHaveTextContent(String(Date.parse("2026-11-08T15:01:00Z")));
});

function ClockOnly() {
  const live = useMatchLive();
  return <>{live?.now.getTime()}</>;
}
