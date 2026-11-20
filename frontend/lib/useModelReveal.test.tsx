/** useModelReveal / useModelRevealMap / ModelGate: the reveal rule wired to
 *  the viewer's real pick state, hydration-safe and batched. */
import { act, render, screen, waitFor } from "@testing-library/react";
import { getMyLeagueTips } from "@/lib/leagueTips";
import { getOrCreateDeviceId } from "@/lib/session";
import { announceTipsIdentityChanged, LEAGUE_TIPS_CACHE_PREFIX } from "@/components/play/tipsIdentity";
import { ModelGate } from "@/components/ModelGate";
import type { LeagueTipsMineMatch, LeagueTipsMineResponse } from "@/lib/types";
import {
  announceLockedPick,
  resetRevealStore,
  useModelReveal,
  useModelRevealMap,
  type ModelReveal,
  type RevealFixture,
} from "./useModelReveal";

jest.mock("@/lib/leagueTips");
jest.mock("@/lib/nrlTips");
jest.mock("@/lib/session", () => {
  const actual = jest.requireActual("@/lib/session");
  return { ...actual, getOrCreateDeviceId: jest.fn() };
});

const mockMine = getMyLeagueTips as jest.MockedFunction<typeof getMyLeagueTips>;
const mockDevice = getOrCreateDeviceId as jest.MockedFunction<typeof getOrCreateDeviceId>;

const at = (mins: number) => new Date(Date.now() + mins * 60_000).toISOString();
const KICKOFF = at(24 * 60);

function row(id: number, over: Partial<LeagueTipsMineMatch> = {}): LeagueTipsMineMatch {
  return {
    id, home: "Arsenal", away: "Chelsea", kickoff_utc: KICKOFF, status: "scheduled",
    score_home: null, score_away: null, model: null, your_prediction: null, ...over,
  };
}

function week(matches: LeagueTipsMineMatch[], matchweek = 11): LeagueTipsMineResponse {
  return { league: "epl", matchweek, handle: null, matches, disclaimer: "" };
}

const picked = (home: number, away: number) => ({
  predicted_home: home, predicted_away: away, points: null, exact: null, graded_at: null, updated_at: null,
});

function fixture(matchId: number, over: Partial<RevealFixture> = {}): RevealFixture {
  return { competition: "epl", matchId, status: "scheduled", kickoffUtc: KICKOFF, matchweek: 11, ...over };
}

/** The Node build of react-dom/server (the browser build needs MessageChannel). */
function renderToString(el: React.ReactElement): string {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g.TextEncoder) g.TextEncoder = jest.requireActual("node:util").TextEncoder;
  const server = jest.requireActual("react-dom/server.node") as typeof import("react-dom/server");
  return server.renderToString(el);
}

let last: ModelReveal | null = null;
function Probe({ f }: { f: RevealFixture }) {
  last = useModelReveal(f);
  return <span data-testid="state">{`${last.revealed}:${last.reason}:${last.isLoading}`}</span>;
}

beforeEach(() => {
  resetRevealStore();
  window.localStorage.clear();
  mockMine.mockReset();
  mockDevice.mockReset();
  mockDevice.mockReturnValue("device-1");
  last = null;
});

describe("useModelReveal", () => {
  it("server-renders an open fixture as hidden and never touches the network", () => {
    const html = renderToString(<Probe f={fixture(205)} />);
    expect(html).toContain("false:hidden:true");
    expect(mockMine).not.toHaveBeenCalled();
  });

  it("hydrates server HTML without a mismatch, then reveals a locked pick", async () => {
    mockMine.mockResolvedValue(week([row(205, { your_prediction: picked(2, 1) })]));
    const html = renderToString(<Probe f={fixture(205)} />);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const errors: string[] = [];
    const { hydrateRoot } = jest.requireActual("react-dom/client") as typeof import("react-dom/client");
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, <Probe f={fixture(205)} />, { onRecoverableError: (e) => errors.push(String(e)) });
    });
    await waitFor(() => expect(container.textContent).toBe("true:locked_pick:false"));
    expect(errors).toEqual([]);
    act(() => root.unmount());
    container.remove();
  });

  it("stays hidden (loading) until the pick state arrives, then hides an unpicked fixture", async () => {
    let resolve!: (v: LeagueTipsMineResponse) => void;
    mockMine.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<Probe f={fixture(205)} />);
    expect(screen.getByTestId("state").textContent).toBe("false:hidden:true");
    await act(async () => resolve(week([row(205)])));
    expect(screen.getByTestId("state").textContent).toBe("false:hidden:false");
    expect(mockMine).toHaveBeenCalledWith("epl", "device-1", 11);
  });

  it("reveals an open fixture the device has locked a pick for, and returns the pick", async () => {
    mockMine.mockResolvedValue(week([row(205, { your_prediction: picked(2, 1) })]));
    render(<Probe f={fixture(205)} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("true:locked_pick:false"));
    expect(last?.pick).toEqual({ kind: "score", home: 2, away: 1, points: null, exact: null, gradedAt: null });
  });

  it("reveals from the confirmed-pick cache before the server answers", async () => {
    mockMine.mockReturnValue(new Promise(() => {}));
    window.localStorage.setItem(
      `${LEAGUE_TIPS_CACHE_PREFIX}epl:11`,
      JSON.stringify({ 205: { predicted_home: 0, predicted_away: 0 } }),
    );
    render(<Probe f={fixture(205)} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("true:locked_pick:false"));
  });

  it("reveals a finished fixture without waiting on the pick", () => {
    mockMine.mockReturnValue(new Promise(() => {}));
    render(<Probe f={fixture(197, { status: "finished", kickoffUtc: at(-3 * 24 * 60) })} />);
    expect(screen.getByTestId("state").textContent).toBe("true:finished:false");
  });

  it("reveals the moment a pick is announced as locked", async () => {
    mockMine.mockResolvedValue(week([row(205)]));
    render(<Probe f={fixture(205)} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("false:hidden:false"));
    act(() =>
      announceLockedPick({
        competition: "epl", matchId: 205, matchweek: 11,
        pick: { kind: "score", home: 1, away: 1, points: null, exact: null, gradedAt: null },
      }),
    );
    expect(screen.getByTestId("state").textContent).toBe("true:locked_pick:false");
    // ...and the shared confirmed-pick cache now holds it, as /play writes it.
    expect(JSON.parse(window.localStorage.getItem(`${LEAGUE_TIPS_CACHE_PREFIX}epl:11`) ?? "{}")).toEqual({
      205: { predicted_home: 1, predicted_away: 1 },
    });
  });

  it("re-reads the server after a sign-in claim", async () => {
    mockMine.mockResolvedValueOnce(week([row(205)]));
    mockMine.mockResolvedValueOnce(week([row(205, { your_prediction: picked(3, 0) })]));
    render(<Probe f={fixture(205)} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("false:hidden:false"));
    act(() => announceTipsIdentityChanged());
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("true:locked_pick:false"));
    expect(mockMine).toHaveBeenCalledTimes(2);
  });

  it("treats a failed read as hidden, not loading forever", async () => {
    mockMine.mockRejectedValue(new Error("boom"));
    render(<Probe f={fixture(205)} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("false:hidden:false"));
  });

  it("reveals an open Champions League fixture (no pick game) without any read", () => {
    render(<Probe f={fixture(900, { competition: "ucl", matchweek: undefined })} />);
    expect(screen.getByTestId("state").textContent).toBe("true:no_pick_game:false");
    expect(mockMine).not.toHaveBeenCalled();
  });

  it("never unlocks an open fixture for a public viewer, even with a pick", async () => {
    mockMine.mockResolvedValue(week([row(205, { your_prediction: picked(2, 1) })]));
    function PublicProbe() {
      const r = useModelReveal(fixture(205), { viewer: "public" });
      return <span data-testid="state">{`${r.revealed}:${r.reason}`}</span>;
    }
    render(<PublicProbe />);
    expect(screen.getByTestId("state").textContent).toBe("false:hidden");
    expect(mockMine).not.toHaveBeenCalled();
  });
});

describe("useModelRevealMap", () => {
  it("answers a whole matchweek from ONE request", async () => {
    mockMine.mockResolvedValue(
      week([row(1, { your_prediction: picked(1, 0) }), row(2), row(3, { status: "finished", kickoff_utc: at(-600) })]),
    );
    const fixtures = [fixture(1), fixture(2), fixture(3, { status: "finished", kickoffUtc: at(-600) })];
    let map: ReturnType<typeof useModelRevealMap> | null = null;
    function List() {
      map = useModelRevealMap(fixtures);
      return <span data-testid="loading">{String(map.isLoading)}</span>;
    }
    render(<List />);
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(mockMine).toHaveBeenCalledTimes(1);
    expect(map!.get(1).reason).toBe("locked_pick");
    expect(map!.get(2).revealed).toBe(false);
    expect(map!.get(3).reason).toBe("finished");
    expect(map!.get(999)).toEqual({ revealed: false, reason: "hidden", pick: null, isLoading: false });
  });

  it("shares the read between several hooks on one page", async () => {
    mockMine.mockResolvedValue(week([row(205, { your_prediction: picked(2, 2) })]));
    render(
      <>
        <Probe f={fixture(205)} />
        <ModelGate fixture={fixture(205)} fallback={<span>locked away</span>}>
          <span>model 2–1</span>
        </ModelGate>
      </>,
    );
    await waitFor(() => expect(screen.getByText("model 2–1")).toBeInTheDocument());
    expect(mockMine).toHaveBeenCalledTimes(1);
  });
});

describe("ModelGate", () => {
  it("server-renders the fallback for an open fixture", () => {
    const html = renderToString(
      <ModelGate fixture={fixture(205)} fallback={<span>Pick to see</span>}>
        <span>model 2–1</span>
      </ModelGate>,
    );
    expect(html).toContain("Pick to see");
    expect(html).not.toContain("model 2–1");
  });

  it("server-renders the model for a finished fixture", () => {
    const html = renderToString(
      <ModelGate fixture={fixture(197, { status: "finished" })} fallback={<span>Pick to see</span>}>
        <span>model 2–1</span>
      </ModelGate>,
    );
    expect(html).toContain("model 2–1");
  });
});
