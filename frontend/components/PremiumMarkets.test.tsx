/** PremiumMarkets: premium fetches + renders the four market blocks; free
 *  users get the gated teaser; billing off renders nothing; fetch errors
 *  collapse quietly (no crash, no broken card). */
import { render, screen, waitFor } from "@testing-library/react";

const mockUseAuth = jest.fn();
jest.mock("@/components/AuthProvider", () => ({ useAuth: () => mockUseAuth() }));
jest.mock("@/lib/constants", () => ({
  ...jest.requireActual("@/lib/constants"),
  BILLING_ENABLED: true,
}));
const mockGet = jest.fn();
jest.mock("@/lib/session", () => ({
  ...jest.requireActual("@/lib/session"),
  getPremiumMarkets: (...a: unknown[]) => mockGet(...a),
}));

import { PremiumMarkets } from "./PremiumMarkets";

const PAYLOAD = {
  match_id: 7,
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

describe("PremiumMarkets", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders the market blocks for a premium user", async () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: true }, loading: false,
                                  openSignIn: jest.fn() });
    mockGet.mockResolvedValue(PAYLOAD);
    render(<PremiumMarkets matchId={7} home="Argentina" away="Cape Verde" />);
    await waitFor(() => expect(screen.getByText(/correct score/i)).toBeInTheDocument());
    expect(screen.getByText(/over\/under/i)).toBeInTheDocument();
    expect(screen.getByText(/both teams to score/i)).toBeInTheDocument();
    expect(screen.getByText(/asian handicap/i)).toBeInTheDocument();
    expect(screen.getByText(/2–0/)).toBeInTheDocument();
    expect(screen.getByText(/Not betting advice/i)).toBeInTheDocument();
  });

  it("shows the gate for a free user and never fetches", () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: false }, loading: false,
                                  openSignIn: jest.fn() });
    render(<PremiumMarkets matchId={7} home="Argentina" away="Cape Verde" />);
    expect(mockGet).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /premium/i })).toBeInTheDocument();
  });

  it("collapses quietly when the fetch fails", async () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: true }, loading: false,
                                  openSignIn: jest.fn() });
    mockGet.mockRejectedValue(new Error("boom"));
    const { container } = render(
      <PremiumMarkets matchId={7} home="A" away="B" />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(container.querySelector("table")).toBeNull(); // no half-rendered card
  });
});

// BILLING_ENABLED is read at import time, and the file-level jest.mock above
// fixes it to `true` for every test in the block above — so proving the
// "billing off" behavior needs a fresh, isolated require of the module graph
// with a different mocked value (same technique as
// components/PremiumGate.test.tsx and app/premium/page.test.tsx's
// "PremiumPage (billing gate)" block). `jest.resetModules()` is required
// before `doMock`, or the isolated require silently resolves the *outer*
// BILLING_ENABLED:true mock instead (confirmed by removing it and
// reproducing the stale-mock failure — same quirk documented in Task 11's
// report).
//
// Unlike those two precedents, PremiumMarkets uses real useState/useEffect
// (not just a mocked useAuth, or a hook-free server component called as a
// plain function). Requiring only the component fresh while rendering it
// with this file's outer `render` would pair an isolated-registry React
// (inside the component's own hooks) with the outer registry's react-dom —
// the same "second, disconnected copy of React" hook-dispatcher mismatch
// the PremiumGate.test.tsx comment warns about for next/link, but hitting
// our own hooks instead. So `render` itself is required fresh from the SAME
// isolated registry too, keeping every piece (react, react-dom, the
// component's hooks) consistent.
//
// That isolated `require("@testing-library/react")` runs `jest.isolateModules`
// at `describe`-collection time (not inside an `it`) because importing it a
// second time re-registers its auto-cleanup `afterEach` — and jest-circus
// rejects hooks registered from inside a running test ("Hooks cannot be
// defined inside tests").
describe("PremiumMarkets billing off", () => {
  const isolatedMockGet = jest.fn();
  let isolatedRender: typeof render = render;
  let IsolatedPremiumMarkets: typeof PremiumMarkets = PremiumMarkets;

  jest.isolateModules(() => {
    jest.resetModules();
    jest.doMock("@/lib/constants", () => ({
      ...jest.requireActual("@/lib/constants"),
      BILLING_ENABLED: false,
    }));
    jest.doMock("@/components/AuthProvider", () => ({
      useAuth: () => ({ user: { id: 1, premium: true }, loading: false,
                        openSignIn: jest.fn() }),
    }));
    jest.doMock("@/lib/session", () => ({
      ...jest.requireActual("@/lib/session"),
      getPremiumMarkets: (...a: unknown[]) => isolatedMockGet(...a),
    }));
    ({ render: isolatedRender } = require("@testing-library/react"));
    ({ PremiumMarkets: IsolatedPremiumMarkets } = require("./PremiumMarkets"));
  });

  it("renders nothing and never fetches, even for a premium user", () => {
    const { container } = isolatedRender(
      <IsolatedPremiumMarkets matchId={7} home="A" away="B" />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(isolatedMockGet).not.toHaveBeenCalled();
  });
});
