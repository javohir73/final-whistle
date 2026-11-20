import { act, render, screen } from "@testing-library/react";
import { getNrlLiveClient } from "@/lib/api";
import type { NrlLive, NrlMatch } from "@/lib/types";
import { LiveMatchProvider } from "./LiveMatchProvider";
import { NrlMatchHero } from "./NrlMatchHero";

jest.mock("@/lib/api");

const mockLive = getNrlLiveClient as jest.MockedFunction<typeof getNrlLiveClient>;

const scheduledMatch: NrlMatch = {
  id: 42,
  match_no: 3,
  // In the live window: the hero only believes a "live" payload while the
  // match could actually be running (see the stale-state tests below).
  kickoff_utc: new Date(Date.now() - 40 * 60_000).toISOString(),
  venue: "Leichhardt Oval",
  home: "Wests Tigers",
  away: "Warriors",
  home_team_id: 17,
  away_team_id: 16,
  score_home: null,
  score_away: null,
  status: "scheduled",
  prediction: {
    p_home: 0.311,
    p_draw: 0.017,
    p_away: 0.672,
    expected_margin: -5.5,
    model_version: "nrl-elo-v0.1",
    created_at: "2026-07-06T00:00:00Z",
    is_shadow: true,
  },
};
const finishedMatch: NrlMatch = {
  ...scheduledMatch,
  status: "finished",
  score_home: 12,
  score_away: 26,
};

const livePayload = (overrides: Partial<NrlLive> = {}): NrlLive => ({
  status: "live",
  minute: 1,
  score_home: 0,
  score_away: 0,
  live_home_prob: 0.5,
  events: [],
  ...overrides,
});

function renderHero(match: NrlMatch = scheduledMatch) {
  return render(
    <LiveMatchProvider match={match}>
      <NrlMatchHero match={match} home={match.home!} away={match.away!} />
    </LiveMatchProvider>,
  );
}

afterEach(() => jest.resetAllMocks());

it("shows the kick-off and never the model's numbers, even when given a prediction", async () => {
  mockLive.mockResolvedValue({
    ...livePayload(),
    status: "pre",
    minute: null,
    score_home: null,
    score_away: null,
  });
  renderHero();
  await act(async () => {});
  expect(screen.queryByText(/LIVE/)).not.toBeInTheDocument();
  // The model's call is its own card on the page, behind the reveal rule.
  expect(screen.queryByText(/Picked|%|Warriors by/)).not.toBeInTheDocument();
});

it("shows no model call at all when the page withholds the prediction (open match)", () => {
  mockLive.mockReturnValue(new Promise(() => {}));
  renderHero({ ...scheduledMatch, prediction: null });
  expect(screen.queryByText(/Picked|%/)).not.toBeInTheDocument();
});

it("shows the updating result while live", async () => {
  mockLive.mockResolvedValue(livePayload({ minute: 42, score_home: 12, score_away: 6 }));
  renderHero();
  // The live region carries the SCORE as content (content changes announce;
  // aria-label changes don't); the visible badge is decorative.
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Live match: Wests Tigers 12–6 Warriors, 42′",
  );
  expect(screen.getByText("LIVE · 42′")).toBeInTheDocument();
  expect(screen.getByText("12–6")).toBeInTheDocument();
});

it("formats a partial live score without adding punctuation for a missing minute", async () => {
  mockLive.mockResolvedValue(livePayload({ minute: null, score_home: 12, score_away: null }));
  renderHero();

  expect(await screen.findByRole("status")).toHaveTextContent(
    "Live match: Wests Tigers 12–– Warriors",
  );
  expect(screen.getByText("LIVE")).toBeInTheDocument();
  expect(screen.getByText("LIVE")).not.toHaveTextContent("·");
  expect(screen.getByText("12––")).toBeInTheDocument();
});

it("preserves the full-time score", () => {
  mockLive.mockReturnValue(new Promise(() => {}));
  renderHero(finishedMatch);
  expect(screen.getByText("Full time")).toBeInTheDocument();
  expect(screen.getByText("12–26")).toBeInTheDocument();
});

it("lists the try scorers under each side of a finished match", async () => {
  mockLive.mockReturnValue(new Promise(() => {}));
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        try_timeline: [
          { minute: 15, team: "Warriors", player: "A. Winger", score_home: 0, score_away: 4 },
          { minute: 35, team: "Wests Tigers", player: "B. Centre", score_home: 6, score_away: 4 },
          { minute: 59, team: "Warriors", player: "A. Winger", score_home: 6, score_away: 10 },
        ],
      }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  try {
    renderHero(finishedMatch);
    expect(await screen.findByRole("list", { name: "Warriors tries" })).toHaveTextContent("A. Winger 15′, 59′");
    expect(screen.getByRole("list", { name: "Wests Tigers tries" })).toHaveTextContent("B. Centre 35′");
    expect(fetchMock).toHaveBeenCalledWith("/backend-api/api/nrl/matches/42/stats", { cache: "no-store" });
  } finally {
    Reflect.deleteProperty(global, "fetch");
  }
});

it("does not fetch try scorers before full time", () => {
  mockLive.mockReturnValue(new Promise(() => {}));
  const fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  try {
    renderHero({ ...scheduledMatch, kickoff_utc: new Date(Date.now() + 86_400_000).toISOString() });
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    Reflect.deleteProperty(global, "fetch");
  }
});

// --- stale/contradictory live states must not produce a LIVE pill ----------

it("never renders LIVE and Full time together — full time wins", async () => {
  // A stale live-state row can survive grading: the match row says finished
  // while /live still answers "live". Two truths, one pill.
  mockLive.mockResolvedValue(livePayload({ minute: 74, score_home: 12, score_away: 26 }));
  renderHero(finishedMatch);
  await act(async () => {});
  expect(screen.getByText("Full time")).toBeInTheDocument();
  expect(screen.queryByText(/LIVE/)).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toBeEmptyDOMElement(); // region stays mounted, silent
});

it("does not pin LIVE on a match far past its window", async () => {
  // Poller died mid-match, ingest lagging: /live keeps answering "live"
  // with a frozen minute. The hero bounds liveness by kickoff, same as
  // every other NRL surface, so it degrades to the pre-match header.
  const staleMatch: NrlMatch = {
    ...scheduledMatch,
    kickoff_utc: new Date(Date.now() - 5 * 60 * 60_000).toISOString(), // 5h ago
  };
  mockLive.mockResolvedValue(livePayload({ minute: 63, score_home: 18, score_away: 12 }));
  renderHero(staleMatch);
  await act(async () => {});
  expect(screen.queryByText(/LIVE/)).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toBeEmptyDOMElement();
  expect(screen.queryByText("18–12")).not.toBeInTheDocument();
});
