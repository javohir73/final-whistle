/** MatchMarkets: every visitor (signed in or not) gets the
 *  fetched market blocks; loading and fetch errors collapse quietly; switching
 *  fixtures never shows the previous fixture's numbers. */
import { render, screen, waitFor } from "@testing-library/react";

const mockGet = jest.fn();
jest.mock("@/lib/session", () => ({
  ...jest.requireActual("@/lib/session"),
  getMatchMarkets: (...a: unknown[]) => mockGet(...a),
}));

import { MatchMarkets } from "./MatchMarkets";

const PAYLOAD = {
  match_id: 42,
  model_version: "poisson-elo-v0.6",
  markets: {
    one_x_two: { home_win: 0.7, draw: 0.2, away_win: 0.1 },
    totals: [{ line: 2.5, over: 0.61, under: 0.39 }],
    btts: { yes: 0.44, no: 0.56 },
    correct_score: [{ home: 2, away: 0, prob: 0.14 },
                    { home: 1, away: 0, prob: 0.13 }],
    asian_handicap: [{ line: -1.0, home: 0.41, push: 0.18, away: 0.41 }],
  },
  disclaimer: "Not betting advice.",
};

describe("MatchMarkets", () => {
  beforeEach(() => jest.clearAllMocks());

  it("fetches for an anonymous visitor and renders the card with real numbers", async () => {
    mockGet.mockResolvedValue(PAYLOAD);
    render(<MatchMarkets matchId={42} home="Argentina" away="Cape Verde" />);
    expect(await screen.findByText("Full match markets")).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith(42);
    expect(screen.getByText(/correct score/i)).toBeInTheDocument();
    expect(screen.getByText(/over\/under/i)).toBeInTheDocument();
    expect(screen.getByText(/both teams to score/i)).toBeInTheDocument();
    expect(screen.getByText(/asian handicap/i)).toBeInTheDocument();
    expect(screen.getByText("2–0")).toBeInTheDocument();
    expect(screen.getByText(/Over 61%/)).toBeInTheDocument();
    expect(screen.getByText(/Yes 44%/)).toBeInTheDocument();
    expect(screen.getByText(/Not betting advice/i)).toBeInTheDocument();
  });

  it("never mentions Premium and never renders a teaser", async () => {
    mockGet.mockResolvedValue(PAYLOAD);
    const { container } = render(<MatchMarkets matchId={42} home="A" away="B" />);
    await screen.findByText("Full match markets");
    expect(container.textContent).not.toMatch(/premium|members/i);
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it("renders nothing while loading", () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { container } = render(<MatchMarkets matchId={42} home="A" away="B" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the fetch fails", async () => {
    mockGet.mockRejectedValue(new Error("boom"));
    const { container } = render(<MatchMarkets matchId={42} home="A" away="B" />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("clears the previous match while a new match loads", async () => {
    let resolveNext: ((value: typeof PAYLOAD) => void) | undefined;
    mockGet
      .mockResolvedValueOnce(PAYLOAD)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNext = resolve; }));

    const { rerender } = render(<MatchMarkets matchId={42} home="A" away="B" />);
    expect(await screen.findByText("2–0")).toBeInTheDocument();

    rerender(<MatchMarkets matchId={43} home="C" away="D" />);
    expect(screen.queryByText("2–0")).toBeNull();
    expect(screen.queryByText("Full match markets")).toBeNull();

    resolveNext?.({
      ...PAYLOAD,
      match_id: 43,
      markets: { ...PAYLOAD.markets, correct_score: [{ home: 3, away: 1, prob: 0.2 }] },
    });
    expect(await screen.findByText("3–1")).toBeInTheDocument();
  });

  it("ignores an older request that resolves after the current match", async () => {
    let resolveOld: ((value: typeof PAYLOAD) => void) | undefined;
    let resolveCurrent: ((value: typeof PAYLOAD) => void) | undefined;
    mockGet
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveCurrent = resolve; }));

    const { rerender } = render(<MatchMarkets matchId={42} home="A" away="B" />);
    rerender(<MatchMarkets matchId={43} home="C" away="D" />);
    resolveCurrent?.({
      ...PAYLOAD,
      match_id: 43,
      markets: { ...PAYLOAD.markets, correct_score: [{ home: 3, away: 1, prob: 0.2 }] },
    });
    expect(await screen.findByText("3–1")).toBeInTheDocument();

    resolveOld?.(PAYLOAD);
    await waitFor(() => expect(screen.queryByText("2–0")).toBeNull());
    expect(screen.getByText("3–1")).toBeInTheDocument();
  });
});
