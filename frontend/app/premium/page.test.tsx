/** /premium: shows both prices + trial copy + disclaimer; CTA branches by
 *  auth state; checkout redirect uses the session URL. */
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockUseAuth = jest.fn();
jest.mock("@/components/AuthProvider", () => ({ useAuth: () => mockUseAuth() }));

const mockCheckout = jest.fn();
const mockPortal = jest.fn();
jest.mock("@/lib/session", () => ({
  ...jest.requireActual("@/lib/session"),
  createCheckoutSession: (...a: unknown[]) => mockCheckout(...a),
  createPortalSession: (...a: unknown[]) => mockPortal(...a),
}));

// Mutable so individual tests (the checkout=success poll banner) can opt into
// a non-empty query string without re-mocking the whole module.
let mockParams = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useSearchParams: () => mockParams,
}));

import { PremiumClient } from "./PremiumClient";

describe("PremiumClient", () => {
  // window.location gets stubbed (redirect assertions) in several tests below.
  // Capture the real one so every test starts from — and every test leaves —
  // the same object; otherwise a later `Object.defineProperty` redefinition
  // throws ("Cannot redefine property") once a prior test has replaced it.
  const originalLocation = window.location;

  beforeEach(() => jest.clearAllMocks());
  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
    mockParams = new URLSearchParams();
  });

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
      value: { ...window.location, assign: assignSpy }, writable: true, configurable: true,
    });
    render(<PremiumClient />);
    fireEvent.click(screen.getByRole("button", { name: /start free trial/i }));
    await waitFor(() => expect(mockCheckout).toHaveBeenCalledWith("monthly"));
    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith("https://checkout.stripe.test/x"));
  });

  it("carries a validated competition and return path through hosted Checkout", async () => {
    mockParams = new URLSearchParams(
      "competition=laliga&returnTo=%2Ffootball%2Flaliga%2Fmatch%2F8",
    );
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: false }, loading: false,
                                  openSignIn: jest.fn(), refresh: jest.fn() });
    mockCheckout.mockResolvedValue({ url: "https://checkout.stripe.test/context" });
    const assignSpy = jest.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignSpy }, writable: true, configurable: true,
    });

    render(<PremiumClient />);
    fireEvent.click(screen.getByRole("button", { name: /start free trial/i }));

    await waitFor(() => expect(mockCheckout).toHaveBeenCalledWith("monthly", {
      competition: "laliga",
      returnTo: "/football/laliga/match/8",
    }));
  });

  it("offers a safe route back to the selected competition after activation", () => {
    mockParams = new URLSearchParams(
      "checkout=success&competition=epl&returnTo=%2Ffootball%2Fepl%2Fmatch%2F105",
    );
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: true }, loading: false,
                                  openSignIn: jest.fn(), refresh: jest.fn() });

    render(<PremiumClient />);

    expect(screen.getByRole("link", { name: /Back to Premier League/i })).toHaveAttribute(
      "href",
      "/football/epl/match/105",
    );
  });

  it.each(["/\\evil.example/steal", "/%5C%5Cevil.example/steal", "/football/nrl"])(
    "rejects unsafe or cross-competition return path %s",
    (returnTo) => {
      mockParams = new URLSearchParams({
        checkout: "success",
        competition: "epl",
        returnTo,
      });
      mockUseAuth.mockReturnValue({ user: { id: 1, premium: true }, loading: false,
                                    openSignIn: jest.fn(), refresh: jest.fn() });

      render(<PremiumClient />);

      expect(screen.getByRole("link", { name: /Back to Premier League/i })).toHaveAttribute(
        "href",
        "/football/epl",
      );
    },
  );

  it("checks out the annual plan once selected", async () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: false }, loading: false,
                                  openSignIn: jest.fn(), refresh: jest.fn() });
    mockCheckout.mockResolvedValue({ url: "https://checkout.stripe.test/annual" });
    const assignSpy = jest.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignSpy }, writable: true, configurable: true,
    });
    render(<PremiumClient />);
    fireEvent.click(screen.getByRole("radio", { name: /39\.99/ }));
    fireEvent.click(screen.getByRole("button", { name: /start free trial/i }));
    await waitFor(() => expect(mockCheckout).toHaveBeenCalledWith("annual"));
    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith("https://checkout.stripe.test/annual"));
  });

  it("surfaces a friendly error when checkout fails", async () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: false }, loading: false,
                                  openSignIn: jest.fn(), refresh: jest.fn() });
    mockCheckout.mockRejectedValue(new Error("network exploded"));
    render(<PremiumClient />);
    fireEvent.click(screen.getByRole("button", { name: /start free trial/i }));
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
  });

  it("anonymous user is sent to sign-in first, and completing sign-in resumes checkout", async () => {
    const openSignIn = jest.fn();
    mockUseAuth.mockReturnValue({ user: null, loading: false, openSignIn,
                                  refresh: jest.fn() });
    mockCheckout.mockResolvedValue({ url: "https://checkout.stripe.test/x" });
    const assignSpy = jest.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignSpy }, writable: true, configurable: true,
    });
    render(<PremiumClient />);
    fireEvent.click(screen.getByRole("button", { name: /start free trial/i }));

    // Not just "called" — the modal must open on the signup tab, and hold an
    // onSuccess that actually resumes checkout once auth completes.
    expect(openSignIn).toHaveBeenCalledWith({
      mode: "signup",
      onSuccess: expect.any(Function),
    });
    expect(mockCheckout).not.toHaveBeenCalled();

    // onSuccess (captured above) calls the async startCheckout — await the
    // act() call itself (not just the assertions below) so its pending
    // microtasks are fully flushed before the test ends. A bare, un-awaited
    // `act(() => onSuccess())` returns a Promise that React logs as
    // "act(async () => ...) without await" and settles AFTER this test
    // returns, corrupting the render for whichever test runs next.
    const { onSuccess } = openSignIn.mock.calls[0][0];
    await act(async () => {
      onSuccess();
    });

    await waitFor(() => expect(mockCheckout).toHaveBeenCalledWith("monthly"));
    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith("https://checkout.stripe.test/x"));
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

  it("premium user's manage button redirects to the billing portal", async () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: true }, loading: false,
                                  openSignIn: jest.fn(), refresh: jest.fn() });
    mockPortal.mockResolvedValue({ url: "https://billing.stripe.test/portal" });
    const assignSpy = jest.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignSpy }, writable: true, configurable: true,
    });
    render(<PremiumClient />);
    fireEvent.click(screen.getByRole("button", { name: /manage subscription/i }));
    await waitFor(() => expect(mockPortal).toHaveBeenCalled());
    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith("https://billing.stripe.test/portal"));
  });

  it("surfaces a friendly error when opening the portal fails", async () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: true }, loading: false,
                                  openSignIn: jest.fn(), refresh: jest.fn() });
    mockPortal.mockRejectedValue(new Error("portal down"));
    render(<PremiumClient />);
    fireEvent.click(screen.getByRole("button", { name: /manage subscription/i }));
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
  });

  it("past-due user sees the payment-issue banner", () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, premium: true, premium_status: "past_due" },
      loading: false, openSignIn: jest.fn(), refresh: jest.fn(),
    });
    render(<PremiumClient />);
    expect(screen.getByText(/payment issue/i)).toBeInTheDocument();
  });

  it("checkout=success polls refresh for a not-yet-premium user, capped at 5 tries", () => {
    jest.useFakeTimers();
    try {
      mockParams = new URLSearchParams("checkout=success");
      const refresh = jest.fn();
      mockUseAuth.mockReturnValue({ user: { id: 1, premium: false }, loading: false,
                                    openSignIn: jest.fn(), refresh });
      render(<PremiumClient />);
      expect(screen.getByText(/activating your membership/i)).toBeInTheDocument();

      // 7 ticks worth of time in one go: the 5th tick must clear the interval,
      // so ticks 6 and 7 must NOT produce further calls.
      act(() => {
        jest.advanceTimersByTime(2000 * 7);
      });
      expect(refresh).toHaveBeenCalledTimes(5);
    } finally {
      jest.useRealTimers();
    }
  });

  it("checkout=success shows the confirmed banner for an already-premium user", () => {
    mockParams = new URLSearchParams("checkout=success");
    const refresh = jest.fn();
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: true }, loading: false,
                                  openSignIn: jest.fn(), refresh });
    render(<PremiumClient />);
    expect(screen.getByText(/you're premium/i)).toBeInTheDocument();
    // Already premium — the poll loop must never have started.
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("PremiumPage (billing gate)", () => {
  // BILLING_ENABLED (and next/navigation's notFound) are read/imported at
  // module-evaluation time, so each case gets its own isolated require —
  // same technique as components/PremiumGate.test.tsx. `Page()` is called
  // directly (not rendered): a server component invoked as a plain function
  // only *constructs* its JSX (PremiumClient's body never runs), so this
  // stays clear of the dual-React-copy issue isolateModules causes for any
  // component that's actually rendered through hooks.
  function loadPage(billingEnabled: boolean, mockNotFound: jest.Mock) {
    let Page!: () => unknown;
    jest.isolateModules(() => {
      // The PremiumClient tests above already required "next/navigation"
      // through the file's top-level jest.mock(), which caches a mock
      // instance outside of any isolateModules scope. Without resetModules()
      // here, doMock's replacement factory below is silently ignored and the
      // isolated require resolves the STALE outer mock (no `notFound` key) —
      // confirmed by direct debugging: dropping this line makes `notFound`
      // undefined inside page.tsx even though doMock ran.
      jest.resetModules();
      jest.doMock("@/lib/constants", () => ({
        ...jest.requireActual("@/lib/constants"),
        BILLING_ENABLED: billingEnabled,
      }));
      jest.doMock("next/navigation", () => ({
        notFound: mockNotFound,
        useSearchParams: () => new URLSearchParams(),
      }));
      Page = require("./page").default;
    });
    return Page;
  }

  it("calls notFound() when billing is disabled", () => {
    const mockNotFound = jest.fn();
    const Page = loadPage(false, mockNotFound);
    Page();
    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it("does not call notFound() when billing is enabled", () => {
    const mockNotFound = jest.fn();
    const Page = loadPage(true, mockNotFound);
    Page();
    expect(mockNotFound).not.toHaveBeenCalled();
  });
});
