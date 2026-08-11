/** /premium: shows both prices + trial copy + disclaimer; CTA branches by
 *  auth state; checkout redirect uses the session URL. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockUseAuth = jest.fn();
jest.mock("@/components/AuthProvider", () => ({ useAuth: () => mockUseAuth() }));

const mockCheckout = jest.fn();
jest.mock("@/lib/session", () => ({
  ...jest.requireActual("@/lib/session"),
  createCheckoutSession: (...a: unknown[]) => mockCheckout(...a),
  createPortalSession: jest.fn(),
}));
jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

import { PremiumClient } from "./PremiumClient";

describe("PremiumClient", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows pricing, trial and the disclaimer", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false,
                                  openSignIn: jest.fn(), refresh: jest.fn() });
    render(<PremiumClient />);
    expect(screen.getByText(/\$4\.99/)).toBeInTheDocument();
    expect(screen.getByText(/\$39\.99/)).toBeInTheDocument();
    expect(screen.getByText(/7-day free trial/i)).toBeInTheDocument();
    expect(screen.getByText(/Not betting advice/i)).toBeInTheDocument();
  });

  it("signed-in free user goes straight to checkout", async () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: false }, loading: false,
                                  openSignIn: jest.fn(), refresh: jest.fn() });
    mockCheckout.mockResolvedValue({ url: "https://checkout.stripe.test/x" });
    const assignSpy = jest.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignSpy }, writable: true,
    });
    render(<PremiumClient />);
    fireEvent.click(screen.getByRole("button", { name: /start free trial/i }));
    await waitFor(() => expect(mockCheckout).toHaveBeenCalledWith("monthly"));
    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith("https://checkout.stripe.test/x"));
  });

  it("anonymous user is sent to sign-in first", () => {
    const openSignIn = jest.fn();
    mockUseAuth.mockReturnValue({ user: null, loading: false, openSignIn,
                                  refresh: jest.fn() });
    render(<PremiumClient />);
    fireEvent.click(screen.getByRole("button", { name: /start free trial/i }));
    expect(openSignIn).toHaveBeenCalled();
    expect(mockCheckout).not.toHaveBeenCalled();
  });

  it("premium user sees manage instead of buy", () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: true }, loading: false,
                                  openSignIn: jest.fn(), refresh: jest.fn() });
    render(<PremiumClient />);
    expect(screen.getByRole("button", { name: /manage subscription/i }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start free trial/i }))
      .not.toBeInTheDocument();
  });

  it("past-due user sees the payment-issue banner", () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, premium: true, premium_status: "past_due" },
      loading: false, openSignIn: jest.fn(), refresh: jest.fn(),
    });
    render(<PremiumClient />);
    expect(screen.getByText(/payment issue/i)).toBeInTheDocument();
  });
});
