/** MatchPick (direction G): the pick inside the match hero. Both boxes start
 *  EMPTY, the first tap on a side sets it (+ → 1, − → 0) and an empty other
 *  side to 0, the lock stays disabled until a score is set, a lock goes
 *  through the SAME /tips/submit (5 exact / 2 result) and announces the pick
 *  so every gated section reveals at once, and a locked pick is final. */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { getMatchSummary } from "@/lib/api";
import { getMyLeagueTips, submitLeagueTip } from "@/lib/leagueTips";
import { ApiError, getOrCreateDeviceId, pingDailyActivity } from "@/lib/session";
import { trackEvent } from "@/lib/analytics";
import { announceLockedPick, resetRevealStore } from "@/lib/useModelReveal";
import type { LeagueTipsMineMatch, LeagueTipsMineResponse, MatchSummary } from "@/lib/types";
import { MatchLiveProvider } from "./MatchLiveProvider";
import { MatchHero } from "./MatchHero";
import { MatchPick, pickLockLine } from "./MatchPick";
import type { WeekFixture } from "./matchPageData";
import { hydrateAcrossTime } from "./hydrate.testutil";
import { announceTipsIdentityChanged } from "@/components/play/tipsIdentity";

jest.mock("@/lib/api");
jest.mock("@/lib/leagueTips");
jest.mock("@/lib/analytics");
jest.mock("@/lib/session", () => {
  const actual = jest.requireActual("@/lib/session");
  return { ...actual, getOrCreateDeviceId: jest.fn(), pingDailyActivity: jest.fn() };
});
jest.mock("@/lib/useModelReveal", () => {
  const actual = jest.requireActual("@/lib/useModelReveal");
  return { ...actual, announceLockedPick: jest.fn(actual.announceLockedPick) };
});

const mockMine = getMyLeagueTips as jest.MockedFunction<typeof getMyLeagueTips>;
const mockSubmit = submitLeagueTip as jest.MockedFunction<typeof submitLeagueTip>;
const mockDevice = getOrCreateDeviceId as jest.MockedFunction<typeof getOrCreateDeviceId>;
const mockPing = pingDailyActivity as jest.MockedFunction<typeof pingDailyActivity>;
const mockTrack = trackEvent as jest.MockedFunction<typeof trackEvent>;
const mockSummary = getMatchSummary as jest.MockedFunction<typeof getMatchSummary>;
const mockAnnounce = announceLockedPick as jest.MockedFunction<typeof announceLockedPick>;

const at = (mins: number) => new Date(Date.now() + mins * 60_000).toISOString();
const DEVICE = "8b1c5d2e-1f3a-4c5b-9d6e-7f8a9b0c1d2e";

function summary(over: Partial<MatchSummary> = {}): MatchSummary {
  return {
    match_id: 501, stage: "group", group: null, kickoff_utc: at(24 * 60),
    venue: null, venue_city: null, venue_country: null, is_neutral: false,
    status: "scheduled", score_home: null, score_away: null, minute: null,
    period: null, injury_time: null, penalty_home: null, penalty_away: null,
    goal_events: [], teams: { home: "Arsenal", away: "Chelsea" },
    predicted_winner: null, probabilities: null, predicted_score: null, confidence: null,
    matchweek: 11,
    ...over,
  };
}

function row(over: Partial<LeagueTipsMineMatch> = {}): LeagueTipsMineMatch {
  return {
    id: 501, home: "Arsenal", away: "Chelsea", kickoff_utc: at(24 * 60), status: "scheduled",
    score_home: null, score_away: null, model: null, your_prediction: null,
    ...over,
  };
}

const OTHER: LeagueTipsMineMatch = {
  id: 502, home: "Leeds", away: "Everton", kickoff_utc: at(25 * 60), status: "scheduled",
  score_home: null, score_away: null, model: null, your_prediction: null,
};

function mine(...rows: LeagueTipsMineMatch[]): LeagueTipsMineResponse {
  return { league: "epl", matchweek: 11, handle: "SwiftStriker42", matches: rows.length ? rows : [row()], disclaimer: "" };
}

const WEEK: WeekFixture[] = [
  { id: 501, home: "Arsenal", away: "Chelsea", kickoffUtc: at(24 * 60), status: "scheduled", matchweek: 11 },
  { id: 502, home: "Leeds", away: "Everton", kickoffUtc: at(25 * 60), status: "scheduled", matchweek: 11 },
];

const MODEL = { predicted_home: 1, predicted_away: 0, model_version: "poisson-elo-club-v0.6" };
const PICKED = { predicted_home: 2, predicted_away: 1, points: null, exact: null, graded_at: null, updated_at: null };

function renderPick(
  s: MatchSummary | null = summary(),
  competition: "epl" | "wc26" | "ucl" = "epl",
  extra: { week?: WeekFixture[]; onLocked?: () => void } = {},
) {
  const kickoff = s?.kickoff_utc ?? at(24 * 60);
  // The page's live poll keeps reporting the same state unless a test says otherwise.
  if (s) mockSummary.mockResolvedValue(s);
  return render(
    <MatchLiveProvider matchId={501} competition={competition} kickoffUtc={kickoff} initialSummary={s}>
      <MatchPick
        competition={competition}
        matchId={501}
        home="Arsenal"
        away="Chelsea"
        kickoffUtc={kickoff}
        matchweek={s?.matchweek}
        week={extra.week ?? WEEK}
        onLocked={extra.onLocked}
      />
    </MatchLiveProvider>,
  );
}

const lockButton = () => screen.getByRole("button", { name: /Lock in|Use \+ and − to set a score|Locking in/ });

beforeEach(() => {
  localStorage.clear();
  resetRevealStore();
  mockDevice.mockReturnValue(DEVICE);
  mockPing.mockResolvedValue(undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  mockMine.mockReset();
  mockSubmit.mockReset();
  mockSummary.mockReset();
});

describe("the empty start and the first-tap rule", () => {
  it("starts with both boxes empty and the lock disabled", async () => {
    mockMine.mockResolvedValue(mine());
    renderPick();
    const group = await screen.findByRole("group", { name: "Set your score" });
    expect(within(group).getAllByText("not set")).toHaveLength(2);
    expect(within(group).queryByText("0")).not.toBeInTheDocument();
    const lock = lockButton();
    expect(lock).toBeDisabled();
    expect(lock).toHaveTextContent("Use + and − to set a score");
    expect(screen.getByText("Exact score 5 points, right result 2. A locked pick is final.")).toBeInTheDocument();
    // Both − buttons are live while empty: a first − sets that side to 0.
    expect(screen.getByRole("button", { name: "Take a goal off Arsenal" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Take a goal off Chelsea" })).toBeEnabled();
  });

  it("first + sets that side to 1 and the empty other side to 0", async () => {
    mockMine.mockResolvedValue(mine());
    renderPick();
    fireEvent.click(await screen.findByRole("button", { name: "Add a goal for Arsenal" }));
    expect(lockButton()).toBeEnabled();
    expect(lockButton()).toHaveTextContent("Lock in Arsenal 1–0 Chelsea");
  });

  it("first − sets that side to 0 and the empty other side to 0", async () => {
    mockMine.mockResolvedValue(mine());
    renderPick();
    fireEvent.click(await screen.findByRole("button", { name: "Take a goal off Chelsea" }));
    expect(lockButton()).toHaveTextContent("Lock in Arsenal 0–0 Chelsea");
    // At 0 the − is spent; the + still works.
    expect(screen.getByRole("button", { name: "Take a goal off Chelsea" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Add a goal for Chelsea" }));
    expect(lockButton()).toHaveTextContent("Lock in Arsenal 0–1 Chelsea");
  });

  it("then steps by one, clamped at 15", async () => {
    mockMine.mockResolvedValue(mine());
    renderPick();
    const plus = await screen.findByRole("button", { name: "Add a goal for Arsenal" });
    for (let i = 0; i < 20; i += 1) fireEvent.click(plus);
    expect(lockButton()).toHaveTextContent("Lock in Arsenal 15–0 Chelsea");
    expect(plus).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Take a goal off Arsenal" }));
    expect(lockButton()).toHaveTextContent("Lock in Arsenal 14–0 Chelsea");
  });

  it("announces the boxes politely", async () => {
    mockMine.mockResolvedValue(mine());
    const { container } = renderPick();
    await screen.findByRole("group", { name: "Set your score" });
    expect(container.querySelectorAll('#pick [aria-live="polite"]')).toHaveLength(2);
  });
});

describe("locking", () => {
  it("submits through the existing endpoint, announces the pick, and shows it as final", async () => {
    mockMine.mockResolvedValue(mine(row(), OTHER));
    mockSubmit.mockResolvedValue({
      ok: true, handle: "SwiftStriker42", model: MODEL,
      prediction: { match_id: 501, predicted_home: 2, predicted_away: 1, updated_at: "2026-11-03T10:00:00+00:00" },
    });
    const onLocked = jest.fn();
    renderPick(summary(), "epl", { onLocked });

    fireEvent.click(await screen.findByRole("button", { name: "Add a goal for Arsenal" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a goal for Arsenal" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a goal for Chelsea" }));
    expect(mockSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Lock in Arsenal 2–1 Chelsea" }));

    expect(await screen.findByText(/Locked\. You and the model agree on the result and differ on the score\./)).toBeInTheDocument();
    expect(mockSubmit).toHaveBeenCalledWith("epl", {
      device_id: DEVICE, match_id: 501, predicted_home: 2, predicted_away: 1,
    });
    expect(mockAnnounce).toHaveBeenCalledWith({
      competition: "epl", matchId: 501, matchweek: 11,
      pick: { kind: "score", home: 2, away: 1, points: null, exact: null, gradedAt: null },
    });
    expect(onLocked).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith("pick_submit", { competition: "epl", match_id: 501, source: "match_page" });
    expect(JSON.parse(localStorage.getItem("finalwhistle:engagement:v1") ?? "{}").picks).toBe(1);
    expect(mockPing).toHaveBeenCalled();
    // /play's cache sees it at once (written by announceLockedPick).
    expect(JSON.parse(localStorage.getItem("finalwhistle:league-tips:v1:epl:11") ?? "{}")[501]).toEqual({
      predicted_home: 2, predicted_away: 1,
    });
    // Final: no steppers, no lock, no edit.
    expect(screen.queryByRole("group", { name: "Set your score" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lock in|Add a goal|Take a goal|Edit|Change/ })).not.toBeInTheDocument();
    // On to the next unpicked match of the matchweek.
    expect(await screen.findByRole("link", { name: "Next: Leeds v Everton" })).toHaveAttribute(
      "href",
      "/football/epl/match/502",
    );
  });

  it("moves keyboard focus to the announced Locked status after a server-accepted lock", async () => {
    mockMine.mockResolvedValue(mine(row(), OTHER));
    mockSubmit.mockResolvedValue({
      ok: true, handle: "SwiftStriker42", model: MODEL,
      prediction: { match_id: 501, predicted_home: 2, predicted_away: 1, updated_at: "2026-11-03T10:00:00+00:00" },
    });
    renderPick(summary(), "epl");
    fireEvent.click(await screen.findByRole("button", { name: "Add a goal for Arsenal" }));
    const lock = lockButton();
    lock.focus();
    expect(lock).toHaveFocus();
    fireEvent.click(lock);

    const status = (await screen.findByText(/Locked\./)).closest('[role="status"]') as HTMLElement;
    expect(status).toHaveTextContent(/^Locked\./);
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("tabindex", "-1");
    await waitFor(() => expect(status).toHaveFocus());
    expect(document.activeElement).not.toBe(document.body);
  });

  it("does not move focus when the pick was already locked on load", async () => {
    mockMine.mockResolvedValue(mine(row({ model: MODEL, your_prediction: PICKED })));
    renderPick();
    const status = (await screen.findByText(/Locked\./)).closest('[role="status"]');
    expect(status).not.toBeNull();
    expect(status).not.toHaveFocus();
  });

  it("keeps focus where it was when the server refuses the lock", async () => {
    mockMine.mockResolvedValue(mine(row(), OTHER));
    mockSubmit.mockRejectedValue(new ApiError(500, "server_error", "Something went wrong."));
    renderPick(summary(), "epl");
    fireEvent.click(await screen.findByRole("button", { name: "Add a goal for Arsenal" }));
    fireEvent.click(lockButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    expect(screen.queryByText(/^Locked\./)).not.toBeInTheDocument();
  });

  it("says All picked when nothing else in the matchweek is open and unpicked", async () => {
    mockMine.mockResolvedValue(mine(row({ model: MODEL, your_prediction: PICKED }), { ...OTHER, your_prediction: PICKED }));
    renderPick();
    expect(await screen.findByRole("link", { name: "All picked. See my picks" })).toHaveAttribute(
      "href",
      "/play?competition=epl",
    );
  });

  it("shows an existing pick as locked, never the stepper", async () => {
    mockMine.mockResolvedValue(mine(row({ model: MODEL, your_prediction: PICKED })));
    renderPick();
    expect(await screen.findByText(/Locked\. You and the model agree on the result/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lock in|Add a goal/ })).not.toBeInTheDocument();
  });

  it("looks the pick up in the payload's matchweek", async () => {
    mockMine.mockResolvedValue(mine(row({ model: MODEL, your_prediction: PICKED })));
    renderPick(summary({ matchweek: 11 }));
    await screen.findByText(/Locked\./);
    expect(mockMine).toHaveBeenCalledWith("epl", DEVICE, 11);
    expect(mockMine.mock.calls.every((c) => c[2] === 11)).toBe(true);
  });

  it("shows the pick that already exists when the server says it is final", async () => {
    mockMine
      .mockResolvedValueOnce(mine())
      .mockResolvedValue(mine(row({ model: MODEL, your_prediction: { ...PICKED, predicted_home: 1, predicted_away: 1 } })));
    mockSubmit.mockRejectedValue(
      new ApiError(409, "prediction_finalized", "Your prediction is final because the model score has been revealed."),
    );
    renderPick(summary(), "epl", { week: [] });
    fireEvent.click(await screen.findByRole("button", { name: "Add a goal for Arsenal" }));
    fireEvent.click(screen.getByRole("button", { name: "Lock in Arsenal 1–0 Chelsea" }));

    expect(await screen.findByText(/Locked\. You are against the model on this one\./)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/final because the model score has been revealed/);
    expect(mockTrack).not.toHaveBeenCalled();
    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it("closes the stepper at once when the server says the match is locked", async () => {
    mockMine.mockResolvedValue(mine());
    mockSubmit.mockRejectedValue(new ApiError(422, "match_locked", "Match 501 has kicked off and is locked."));
    renderPick(summary(), "epl", { week: [] });
    fireEvent.click(await screen.findByRole("button", { name: "Take a goal off Arsenal" }));
    fireEvent.click(screen.getByRole("button", { name: "Lock in Arsenal 0–0 Chelsea" }));

    expect(await screen.findByText(/Picks closed at kick-off/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lock in/ })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("This match has kicked off, so picks are closed.");
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft and says so calmly when the network fails", async () => {
    mockMine.mockResolvedValue(mine());
    mockSubmit.mockRejectedValue(new TypeError("Failed to fetch"));
    renderPick();
    fireEvent.click(await screen.findByRole("button", { name: "Add a goal for Arsenal" }));
    fireEvent.click(screen.getByRole("button", { name: "Lock in Arsenal 1–0 Chelsea" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn’t save your pick/);
    expect(lockButton()).toHaveTextContent("Lock in Arsenal 1–0 Chelsea");
    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it("stops offering the stepper when the server has a pick the lookup cannot find", async () => {
    mockMine.mockResolvedValue({ ...mine(), matches: [] });
    mockSubmit.mockRejectedValue(
      new ApiError(409, "prediction_finalized", "Your prediction is final because the model score has been revealed."),
    );
    renderPick(summary({ matchweek: 11 }), "epl", { week: [] });
    fireEvent.click(await screen.findByRole("button", { name: "Add a goal for Arsenal" }));
    fireEvent.click(screen.getByRole("button", { name: "Lock in Arsenal 1–0 Chelsea" }));

    expect(await screen.findByText("Your pick for this match is already locked in.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lock in/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See it in My picks" })).toHaveAttribute("href", "/play?competition=epl");
  });
});

describe("other states", () => {
  it("after kickoff with no pick: closed, no model numbers, no stepper", async () => {
    const kicked = summary({ kickoff_utc: at(-20), status: "in_play", minute: 20, period: "first_half", score_home: 0, score_away: 0 });
    mockMine.mockResolvedValue(mine(row({ kickoff_utc: kicked.kickoff_utc, status: "in_play", model: MODEL })));
    renderPick(kicked, "epl", { week: [] });
    expect(await screen.findByText("Picks closed at kick-off. You didn’t pick this one.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lock in|Add a goal/ })).not.toBeInTheDocument();
  });

  it("renders nothing for a finished match (the call card shows the pick and its points)", async () => {
    const done = summary({ kickoff_utc: at(-3 * 24 * 60), status: "finished", score_home: 3, score_away: 1 });
    mockMine.mockResolvedValue(mine(row({ status: "finished", score_home: 3, score_away: 1, model: MODEL, your_prediction: PICKED })));
    const { container } = renderPick(done);
    await waitFor(() => expect(container.querySelector("#pick")).toBeNull());
  });

  it("keeps the shell and offers a retry when the tips API fails", async () => {
    mockMine.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(mine());
    renderPick();
    expect(await screen.findByText("Picks are unavailable right now.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your pick" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("group", { name: "Set your score" })).toBeInTheDocument();
  });

  it("locks the stepper at kickoff on an open tab, without a reload", async () => {
    jest.useFakeTimers();
    const soon = summary({ kickoff_utc: at(0.25) }); // kicks off in 15 s
    mockMine.mockResolvedValue(mine(row({ kickoff_utc: soon.kickoff_utc })));
    renderPick(soon, "epl", { week: [] });
    await act(async () => {});
    expect(screen.getByRole("group", { name: "Set your score" })).toBeInTheDocument();

    await act(async () => { jest.advanceTimersByTime(30_000); });
    await waitFor(() => expect(screen.queryByRole("group", { name: "Set your score" })).not.toBeInTheDocument());
    expect(screen.getByText(/Picks closed at kick-off/)).toBeInTheDocument();
  });

  it.each([
    ["postponed", "Postponed. Your pick carries over to the new date."],
    ["cancelled", "Cancelled. This pick won’t be scored."],
    ["suspended", "Suspended. Points wait on the outcome."],
  ] as const)("tells a %s match's existing pick what happens to it", async (status, copy) => {
    mockMine.mockResolvedValue(mine(row({ status, model: MODEL, your_prediction: PICKED })));
    renderPick(summary({ status }), "epl", { week: [] });
    expect(await screen.findByText(`Locked. ${copy}`)).toBeInTheDocument();
  });

  it("re-reads the pick when a sign-in claim changes whose tips this device shows", async () => {
    mockMine.mockResolvedValue(mine(row({ model: MODEL, your_prediction: PICKED })));
    renderPick(summary(), "epl", { week: [] });
    expect(await screen.findByText(/agree on the result/)).toBeInTheDocument();

    mockMine.mockResolvedValue(mine(row({ model: MODEL, your_prediction: { ...PICKED, predicted_home: 1, predicted_away: 0 } })));
    act(() => announceTipsIdentityChanged());
    expect(await screen.findByText(/picked the same score/)).toBeInTheDocument();
  });

  it("forgets a pick it only knew locally when the identity changes", async () => {
    mockMine.mockResolvedValue(mine());
    mockSubmit.mockResolvedValue({
      ok: true, handle: "SwiftStriker42", model: MODEL,
      prediction: { match_id: 501, predicted_home: 3, predicted_away: 1, updated_at: "2026-11-03T10:00:00+00:00" },
    });
    renderPick(summary(), "epl", { week: [] });
    const plus = await screen.findByRole("button", { name: "Add a goal for Arsenal" });
    fireEvent.click(plus);
    fireEvent.click(screen.getByRole("button", { name: "Lock in Arsenal 1–0 Chelsea" }));
    expect(await screen.findByText(/agree on the result/)).toBeInTheDocument();

    localStorage.clear(); // the claim clears local caches
    mockMine.mockResolvedValue(mine(row({ model: MODEL, your_prediction: { ...PICKED, predicted_home: 0, predicted_away: 2 } })));
    act(() => announceTipsIdentityChanged());
    expect(await screen.findByText(/against the model/)).toBeInTheDocument();
  });

  it("keeps the World Cup's W/D/L pick for an open archive fixture", () => {
    renderPick(summary(), "wc26");
    const group = screen.getByRole("group", { name: /Your prediction for Arsenal vs Chelsea/ });
    expect(within(group).getByRole("button", { name: "Draw" })).toBeInTheDocument();
    expect(mockMine).not.toHaveBeenCalled();
  });

  it("shows no pick for a finished World Cup archive match", () => {
    const { container } = renderPick(summary({ status: "finished", score_home: 1, score_away: 0, kickoff_utc: at(-500) }), "wc26");
    expect(container.querySelector("#pick")).toBeNull();
  });

  it("says plainly when a competition has no pick game", () => {
    renderPick(summary(), "ucl");
    expect(screen.getByText(/Score picks for the UEFA Champions League aren.t open yet/)).toBeInTheDocument();
    expect(mockMine).not.toHaveBeenCalled();
  });
});

describe("pickLockLine", () => {
  const now = new Date("2026-11-08T10:00:00Z");
  it("names the kickoff time and zone while open", () => {
    expect(pickLockLine("scheduled", "2026-11-08T15:00:00Z", now, "UTC")).toBe("Locks at kickoff · 3:00 pm UTC");
    expect(pickLockLine("scheduled", "2026-11-12T15:00:00Z", now, "UTC")).toBe("Locks at kickoff · Thu 12 Nov, 3:00 pm UTC");
  });
  it("says locked after kickoff, and handles deliberate stops", () => {
    expect(pickLockLine("scheduled", "2026-11-08T09:00:00Z", now, "UTC")).toBe("Locked at kickoff");
    expect(pickLockLine("in_play", "2026-11-08T09:00:00Z", now, "UTC")).toBe("Locked at kickoff");
    expect(pickLockLine("postponed", "2026-11-01T09:00:00Z", now, "UTC")).toBe("Postponed · picks stay open");
    expect(pickLockLine("cancelled", "2026-11-08T15:00:00Z", now, "UTC")).toBe("Cancelled · picks closed");
  });
});

// The page is ISR: HTML rendered before kickoff is hydrated after it. With
// the server's render instant passed in, the first client pass matches the
// HTML exactly; the browser clock takes over after.
describe("hydrating cached HTML", () => {
  const KO = "2026-11-08T15:00:00+00:00";
  const seedAt = summary({ kickoff_utc: KO, matchweek: 11 });
  function tree(serverNow: string) {
    return function HeroAndPickAt() {
      return (
        <MatchLiveProvider matchId={501} competition="epl" kickoffUtc={KO} initialSummary={seedAt} serverNow={serverNow}>
          <MatchHero
            competitionLabel="Premier League"
            home={{ name: "Arsenal", href: null, standing: null }}
            away={{ name: "Chelsea", href: null, standing: null }}
            kickoffUtc={KO}
            venue={null}
            summary={seedAt}
            phase="upcoming"
          >
            <MatchPick competition="epl" matchId={501} home="Arsenal" away="Chelsea" kickoffUtc={KO} matchweek={11} week={[]} />
          </MatchHero>
        </MatchLiveProvider>
      );
    };
  }

  beforeEach(() => {
    localStorage.setItem("pp:timezone", JSON.stringify({ tz: "UTC", confirmed: true }));
    mockSummary.mockResolvedValue(seedAt);
    mockMine.mockResolvedValue(mine(row({ kickoff_utc: KO })));
  });

  it("rendered a minute before kickoff, hydrated a minute after: no mismatch, then closed", async () => {
    const serverNow = "2026-11-08T14:59:00.000Z";
    jest.useFakeTimers({ now: new Date(serverNow) });
    const { html, container, errors } = await hydrateAcrossTime(
      tree(serverNow),
      new Date(serverNow),
      new Date("2026-11-08T15:01:00Z"),
    );
    expect(html).toContain("3:00 pm");
    expect(html).toContain("Loading your pick");
    expect(errors).toEqual([]);
    await act(async () => {});
    expect(container).toHaveTextContent("Picks closed at kick-off");
  });
});
