/** /premium with the in-page Payment Element configured: the CTA reveals the
 *  form inline instead of redirecting, the plan survives the 3DS round trip,
 *  and a deploy without the publishable key still falls back to hosted
 *  Checkout. PremiumCheckout itself is stubbed — its Stripe machinery is
 *  covered by components/PremiumCheckout.test.tsx. */
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

let mockParams = new URLSearchParams();
jest.mock("next/navigation", () => ({ useSearchParams: () => mockParams }));

// A getter, not a value: PremiumClient reads the binding on every render, so a
// snapshot taken when the mock was created would never see a test's change.
let mockPublishableKey = "pk_test_x";
jest.mock("@/lib/constants", () => ({
  ...jest.requireActual("@/lib/constants"),
  get STRIPE_PUBLISHABLE_KEY() {
    return mockPublishableKey;
  },
}));

const mockCheckoutProps: { plan: string; onActivated?: () => void }[] = [];
jest.mock("@/components/PremiumCheckout", () => {
  const react = jest.requireActual("react");
  return {
    PremiumCheckout: (props: { plan: string }) => {
      mockCheckoutProps.push(props);
      return react.createElement("div", { "data-testid": "premium-checkout" }, props.plan);
    },
  };
});

import { PremiumClient } from "./PremiumClient";

const freeUser = { user: { id: 1, premium: false }, loading: false };

describe("PremiumClient (in-page Payment Element)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = new URLSearchParams();
    mockPublishableKey = "pk_test_x";
    mockCheckoutProps.length = 0;
  });

  it("reveals the form inline instead of redirecting to hosted Checkout", async () => {
    mockUseAuth.mockReturnValue({ ...freeUser, openSignIn: jest.fn(), refresh: jest.fn() });

    render(<PremiumClient />);
    expect(screen.queryByTestId("premium-checkout")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /start free trial/i }));

    expect(await screen.findByTestId("premium-checkout")).toBeInTheDocument();
    expect(mockCheckout).not.toHaveBeenCalled();
    expect(mockCheckoutProps[0].plan).toBe("monthly");
  });

  it("passes the selected plan down to the form", async () => {
    mockUseAuth.mockReturnValue({ ...freeUser, openSignIn: jest.fn(), refresh: jest.fn() });

    render(<PremiumClient />);
    fireEvent.click(screen.getByRole("radio", { name: /39\.99/ }));
    fireEvent.click(screen.getByRole("button", { name: /start free trial/i }));

    expect(await screen.findByTestId("premium-checkout")).toBeInTheDocument();
    expect(mockCheckoutProps[mockCheckoutProps.length - 1].plan).toBe("annual");
  });

  it("sends an anonymous visitor to sign-in first, then reveals the form", async () => {
    const openSignIn = jest.fn();
    mockUseAuth.mockReturnValue({ user: null, loading: false, openSignIn, refresh: jest.fn() });

    render(<PremiumClient />);
    fireEvent.click(screen.getByRole("button", { name: /start free trial/i }));

    expect(openSignIn).toHaveBeenCalledWith({ mode: "signup", onSuccess: expect.any(Function) });
    expect(screen.queryByTestId("premium-checkout")).not.toBeInTheDocument();

    const { onSuccess } = openSignIn.mock.calls[0][0];
    await act(async () => {
      onSuccess();
    });

    expect(await screen.findByTestId("premium-checkout")).toBeInTheDocument();
    expect(mockCheckout).not.toHaveBeenCalled();
  });

  it("confirms in the page once the form reports the subscription live", async () => {
    mockUseAuth.mockReturnValue({ ...freeUser, openSignIn: jest.fn(), refresh: jest.fn() });

    render(<PremiumClient />);
    fireEvent.click(screen.getByRole("button", { name: /start free trial/i }));
    expect(await screen.findByTestId("premium-checkout")).toBeInTheDocument();

    // The form unmounts the moment /me reports premium, so the confirmation
    // has to live on the page — otherwise a successful signup says nothing.
    act(() => {
      mockCheckoutProps[mockCheckoutProps.length - 1].onActivated?.();
    });

    expect(await screen.findByText(/activating your membership|you're premium/i))
      .toBeInTheDocument();
  });

  it("comes back from a 3DS redirect with the form open and the plan intact", async () => {
    mockParams = new URLSearchParams(
      "plan=annual&setup_intent=seti_3ds&setup_intent_client_secret=seti_3ds_secret" +
        "&redirect_status=succeeded",
    );
    mockUseAuth.mockReturnValue({ ...freeUser, openSignIn: jest.fn(), refresh: jest.fn() });

    render(<PremiumClient />);

    // No click: the redirect IS the resume, so the form must already be mounted.
    expect(screen.getByTestId("premium-checkout")).toBeInTheDocument();
    // The plan was carried in the return_url because state did not survive.
    expect(mockCheckoutProps[0].plan).toBe("annual");
    expect(screen.getByRole("radio", { name: /39\.99/ })).toBeChecked();
  });

  it("falls back to hosted Checkout when the publishable key is absent", async () => {
    mockPublishableKey = "";
    mockUseAuth.mockReturnValue({ ...freeUser, openSignIn: jest.fn(), refresh: jest.fn() });
    mockCheckout.mockResolvedValue({ url: "https://checkout.stripe.test/x" });
    const assignSpy = jest.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignSpy },
      writable: true,
      configurable: true,
    });

    try {
      render(<PremiumClient />);
      fireEvent.click(screen.getByRole("button", { name: /start free trial/i }));

      await waitFor(() => expect(mockCheckout).toHaveBeenCalledWith("monthly"));
      await waitFor(() =>
        expect(assignSpy).toHaveBeenCalledWith("https://checkout.stripe.test/x"),
      );
      expect(screen.queryByTestId("premium-checkout")).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "location", {
        value: originalLocation,
        writable: true,
        configurable: true,
      });
    }
  });
});
