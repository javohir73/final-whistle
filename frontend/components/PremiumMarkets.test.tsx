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
