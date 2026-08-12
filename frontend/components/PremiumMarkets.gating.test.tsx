/** Anonymous match pages must not carry gated market values.
 *
 *  The bug: the free/anon teaser rendered a hardcoded sample (Over 2.5 = 57%,
 *  BTTS = 48%, a 2-1 scoreline at 11%) inside a blurred, aria-hidden div. Two
 *  failures in one:
 *
 *  - A blur is a visual effect. The digits were in the DOM, reachable by view
 *    source, Reader Mode, a scraper, or any client that ignores aria-hidden.
 *  - They contradicted the public Goals section higher up the same page, which
 *    showed the REAL Over 2.5 and BTTS for that fixture. Two different numbers
 *    for one quantity reads as a broken model, not as marketing.
 *
 *  These tests assert on the SERIALIZED markup rather than on what is visible,
 *  because "visible" is exactly the distinction that failed.
 */
import { render, waitFor } from "@testing-library/react";

jest.mock("@/lib/constants", () => ({
  ...jest.requireActual("@/lib/constants"),
  BILLING_ENABLED: true,
}));

const mockUseAuth = jest.fn();
jest.mock("@/components/AuthProvider", () => ({ useAuth: () => mockUseAuth() }));

const mockGet = jest.fn();
jest.mock("@/lib/session", () => ({ getPremiumMarkets: (id: number) => mockGet(id) }));

import { PremiumMarkets } from "@/components/PremiumMarkets";

const anon = { user: null, loading: false, openSignIn: jest.fn() };
const free = { user: { id: 1, premium: false }, loading: false, openSignIn: jest.fn() };

/** Any "57%" or "0.57" in rendered TEXT.
 *
 *  Asserted against textContent rather than innerHTML on purpose: Tailwind
 *  emits class fragments like `bg-win/[0.06]` and inline `width: 2.2rem`, which
 *  are styling, not market values. Text is what a reader, a screen reader and a
 *  scraper all actually get. The line ladder ("2.5 goals", "-0.5") survives this
 *  by design — one decimal place, and it is the product description rather than
 *  a prediction. */
const PROBABILITY = /\d+(\.\d+)?\s*%|0\.\d{2,}/;
/** A rendered scoreline like "2-1" / "2–1". */
const SCORELINE = /\b\d\s*[-–]\s*\d\b/;

afterEach(() => jest.clearAllMocks());

describe.each([
  ["anonymous", anon],
  ["signed-in free", free],
])("%s visitor", (_label, auth) => {
  it("serializes no probability into the DOM", () => {
    mockUseAuth.mockReturnValue(auth);
    const { container } = render(<PremiumMarkets matchId={7} home="Arsenal" away="Chelsea" />);
    expect(container.textContent ?? "").not.toMatch(PROBABILITY);
  });

  it("serializes no correct-score line into the DOM", () => {
    mockUseAuth.mockReturnValue(auth);
    const { container } = render(<PremiumMarkets matchId={7} home="Arsenal" away="Chelsea" />);
    expect(container.textContent ?? "").not.toMatch(SCORELINE);
  });

  it("never calls the entitled endpoint", async () => {
    // Withholding the values client-side is worthless if the request still
    // goes out — the 403 body, timing and existence are all signal.
    mockUseAuth.mockReturnValue(auth);
    render(<PremiumMarkets matchId={7} home="Arsenal" away="Chelsea" />);
    await waitFor(() => expect(mockGet).not.toHaveBeenCalled());
  });

  it("still describes what the tier buys", () => {
    // The fix must not turn the panel into a blank box: the market NAMES and
    // the fixed line ladder are product description, not per-match prediction.
    mockUseAuth.mockReturnValue(auth);
    const { container } = render(<PremiumMarkets matchId={7} home="Arsenal" away="Chelsea" />);
    const text = container.textContent ?? "";
    expect(text).toContain("Correct score");
    expect(text).toContain("Both teams to score");
    expect(text).toContain("Asian handicap");
  });
});

describe("premium visitor", () => {
  it("does get real values, from the entitled endpoint", async () => {
    // The other half of the contract — the gate must not withhold from members.
    mockUseAuth.mockReturnValue({
      user: { id: 1, premium: true }, loading: false, openSignIn: jest.fn(),
    });
    mockGet.mockResolvedValue({
      disclaimer: "Not betting advice.",
      markets: {
        one_x_two: { home_win: 0.52, draw: 0.26, away_win: 0.22 },
        totals: [{ line: 2.5, over: 0.5305, under: 0.4695 }],
        btts: { yes: 0.5612, no: 0.4388 },
        correct_score: [{ home: 2, away: 1, prob: 0.11 }],
        asian_handicap: [{ line: -0.5, home: 0.52, push: 0, away: 0.48 }],
      },
    });

    const { container } = render(<PremiumMarkets matchId={7} home="Arsenal" away="Chelsea" />);
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith(7));
    await waitFor(() => expect(container.textContent ?? "").toMatch(PROBABILITY));
  });
});
