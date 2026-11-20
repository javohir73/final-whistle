/** In-page Payment Element signup: the happy path, a decline, the 3DS return,
 *  the card-saved-but-subscribe-failed recovery, the missing-key fallback, and
 *  the theme-aware appearance object. Stripe is mocked throughout — nothing
 *  here touches the network or mounts a real iframe. */
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockRefresh = jest.fn();
jest.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ refresh: mockRefresh }),
}));

// Mutable so a test can opt into the 3DS return query string.
let mockParams = new URLSearchParams();
jest.mock("next/navigation", () => ({ useSearchParams: () => mockParams }));

// Mutable so the "half-configured deploy" test can drop the publishable key.
// A getter (not a plain value) because the component reads the binding on every
// render — a snapshot taken at mock time would never see the change.
let mockPublishableKey = "pk_test_x";
jest.mock("@/lib/constants", () => ({
  ...jest.requireActual("@/lib/constants"),
  get STRIPE_PUBLISHABLE_KEY() {
    return mockPublishableKey;
  },
}));

const mockCreateSetupIntent = jest.fn();
const mockSubscribe = jest.fn();
jest.mock("@/lib/session", () => ({
  ...jest.requireActual("@/lib/session"),
  createSetupIntent: (...a: unknown[]) => mockCreateSetupIntent(...a),
  subscribe: (...a: unknown[]) => mockSubscribe(...a),
}));

const mockConfirmSetup = jest.fn();
// Every options object <Elements> was rendered with, in order — the appearance
// test reads the last one to see what the form would actually be styled with.
const mockElementsOptions: { appearance?: Appearance; clientSecret?: string }[] = [];

// Every argument list loadStripe was called with. A plain jest.fn() can't carry
// this: getStripe() memoizes the promise at module scope, so the call happens in
// whichever test renders first and clearAllMocks() wipes the record before any
// later test can read it.
const mockLoadStripeCalls: unknown[][] = [];
jest.mock("@stripe/stripe-js", () => ({
  loadStripe: (...args: unknown[]) => {
    mockLoadStripeCalls.push(args);
    return Promise.resolve({});
  },
}));
jest.mock("@stripe/react-stripe-js", () => {
  const react = jest.requireActual("react");
  return {
    Elements: ({ options, children }: { options: unknown; children: unknown }) => {
      mockElementsOptions.push(options as { appearance?: Appearance });
      return react.createElement("div", { "data-testid": "stripe-elements" }, children);
    },
    PaymentElement: () => react.createElement("div", { "data-testid": "payment-element" }),
    useStripe: () => ({ confirmSetup: (...a: unknown[]) => mockConfirmSetup(...a) }),
    useElements: () => ({}),
  };
});

import type { Appearance } from "@stripe/stripe-js";
import { ApiError } from "@/lib/session";
import { PremiumCheckout } from "./PremiumCheckout";

/** The real direction G token set from globals.css, trimmed to what the
 *  form borrows. jsdom resolves custom properties through the cascade. */
const TOKEN_CSS = `
  :root {
    --win: 161.61 67.39% 18.04%; --surface: 0 0% 100%; --foreground: 218.18 21.57% 10%;
    --muted: 214.29 10.34% 39.8%; --loss: 8.82 58.62% 34.12%; --border: 105 7.69% 89.8%;
  }`;

function installTokens() {
  const style = document.createElement("style");
  style.setAttribute("data-test-tokens", "");
  style.textContent = TOKEN_CSS;
  document.head.appendChild(style);
}

const submitButton = () => screen.getByRole("button", { name: /start free trial/i });

describe("PremiumCheckout", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = new URLSearchParams();
    mockPublishableKey = "pk_test_x";
    mockElementsOptions.length = 0;
    document.head.querySelectorAll("[data-test-tokens]").forEach((n) => n.remove());
    mockCreateSetupIntent.mockResolvedValue({ client_secret: "seti_1_secret_abc" });
  });

  it("confirms the card, then subscribes with the chosen plan", async () => {
    mockConfirmSetup.mockResolvedValue({ setupIntent: { id: "seti_1", status: "succeeded" } });
    mockSubscribe.mockResolvedValue({ status: "trialing", premium: true });

    render(<PremiumCheckout plan="annual" />);

    expect(await screen.findByTestId("payment-element")).toBeInTheDocument();
    // The form mounts against the client secret the backend just issued, with
    // the publishable key behind it. Both are invisible in the DOM: pass the
    // intent id instead of its secret, or the wrong key, and the element looks
    // perfectly mounted here while it can never confirm in a browser.
    expect(mockElementsOptions[mockElementsOptions.length - 1].clientSecret).toBe(
      "seti_1_secret_abc",
    );
    expect(mockLoadStripeCalls).toContainEqual(["pk_test_x"]);
    fireEvent.click(submitButton());

    await waitFor(() => expect(mockConfirmSetup).toHaveBeenCalled());
    const confirmArgs = mockConfirmSetup.mock.calls[0][0];
    // "if_required" keeps a no-challenge card inline; the return_url only
    // matters when the issuer does redirect — and it must carry the plan,
    // because component state does not survive that round trip.
    expect(confirmArgs.redirect).toBe("if_required");
    expect(confirmArgs.confirmParams.return_url).toContain("/premium?plan=annual");

    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledWith("annual", "seti_1"));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(await screen.findByText(/premium is active/i)).toBeInTheDocument();
  });

  it("tells the page it can confirm, once the subscription actually entitles", async () => {
    mockConfirmSetup.mockResolvedValue({ setupIntent: { id: "seti_1" } });
    mockSubscribe.mockResolvedValue({ status: "trialing", premium: true });
    const onActivated = jest.fn();

    render(<PremiumCheckout plan="monthly" onActivated={onActivated} />);
    expect(await screen.findByTestId("payment-element")).toBeInTheDocument();
    fireEvent.click(submitButton());

    await waitFor(() => expect(onActivated).toHaveBeenCalledTimes(1));
  });

  it("does not claim Premium when the subscription did not activate", async () => {
    mockConfirmSetup.mockResolvedValue({ setupIntent: { id: "seti_1" } });
    // A returning subscriber gets no trial, so the first invoice is charged
    // immediately — and can fail, leaving an `incomplete` subscription.
    mockSubscribe.mockResolvedValue({ status: "incomplete", premium: false });
    const onActivated = jest.fn();

    render(<PremiumCheckout plan="monthly" onActivated={onActivated} />);
    expect(await screen.findByTestId("payment-element")).toBeInTheDocument();
    fireEvent.click(submitButton());

    expect(await screen.findByText(/hasn’t activated/i)).toBeInTheDocument();
    expect(screen.queryByText(/premium is active/i)).not.toBeInTheDocument();
    expect(onActivated).not.toHaveBeenCalled();
    // A subscription DOES exist now, so the backend's is_premium-keyed
    // idempotency no longer holds — retrying would buy a second one.
    expect(screen.queryByRole("button", { name: /finish/i })).not.toBeInTheDocument();
  });

  it("shows a decline inline and leaves the form usable", async () => {
    mockConfirmSetup.mockResolvedValue({ error: { message: "Your card was declined." } });

    render(<PremiumCheckout plan="monthly" />);
    expect(await screen.findByTestId("payment-element")).toBeInTheDocument();
    fireEvent.click(submitButton());

    expect(await screen.findByText(/your card was declined/i)).toBeInTheDocument();
    // Still mounted, still resubmittable — a decline is a retry, not a dead end.
    expect(screen.getByTestId("payment-element")).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it("resumes at the subscribe step when it comes back from a 3DS challenge", async () => {
    mockParams = new URLSearchParams(
      "setup_intent=seti_3ds&setup_intent_client_secret=seti_3ds_secret&redirect_status=succeeded",
    );
    mockSubscribe.mockResolvedValue({ status: "active", premium: true });

    render(<PremiumCheckout plan="annual" />);

    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledWith("annual", "seti_3ds"));
    // The card is already confirmed: no second intent, no second confirmation.
    expect(mockCreateSetupIntent).not.toHaveBeenCalled();
    expect(mockConfirmSetup).not.toHaveBeenCalled();
    expect(await screen.findByText(/premium is active/i)).toBeInTheDocument();
  });

  it("starts over when the 3DS challenge did not succeed", async () => {
    // Stripe sends the browser back with the same setup_intent whether the bank
    // approved or not. Resuming on the id alone would POST /subscribe with an
    // unconfirmed intent, take the backend's 403, and land the user in the
    // recovery state — which tells them their card was saved when it wasn't,
    // behind a "Finish activation" button that can only 403 forever.
    mockParams = new URLSearchParams(
      "setup_intent=seti_3ds&setup_intent_client_secret=seti_3ds_secret&redirect_status=failed",
    );

    render(<PremiumCheckout plan="monthly" />);

    expect(await screen.findByTestId("payment-element")).toBeInTheDocument();
    expect(mockCreateSetupIntent).toHaveBeenCalled();
    expect(mockSubscribe).not.toHaveBeenCalled();
    expect(screen.queryByText(/card was saved/i)).not.toBeInTheDocument();
  });

  it("offers to finish when the card was saved but subscribe failed", async () => {
    mockConfirmSetup.mockResolvedValue({ setupIntent: { id: "seti_1", status: "succeeded" } });
    mockSubscribe.mockRejectedValueOnce(
      new ApiError(503, "billing_unavailable", "Billing is temporarily unavailable."),
    );

    render(<PremiumCheckout plan="monthly" />);
    expect(await screen.findByTestId("payment-element")).toBeInTheDocument();
    fireEvent.click(submitButton());

    expect(await screen.findByText(/card was saved/i)).toBeInTheDocument();

    mockSubscribe.mockResolvedValue({ status: "active", premium: true });
    fireEvent.click(screen.getByRole("button", { name: /finish/i }));

    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledTimes(2));
    expect(mockSubscribe).toHaveBeenLastCalledWith("monthly", "seti_1");
    // Retrying must not ask for the card again — that is the whole point of
    // the recovery state, and re-confirming risks a second payment method.
    expect(mockConfirmSetup).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/premium is active/i)).toBeInTheDocument();
  });

  it("surfaces a 503 from setup-intent through friendlyAuthError", async () => {
    mockCreateSetupIntent.mockRejectedValue(
      new ApiError(503, "billing_unavailable", "Billing is temporarily unavailable."),
    );

    render(<PremiumCheckout plan="monthly" />);

    expect(await screen.findByText(/waking up/i)).toBeInTheDocument();
    expect(screen.queryByTestId("payment-element")).not.toBeInTheDocument();
  });

  it("re-checks the session when the backend says the account already subscribes", async () => {
    // 409 means /me is behind the backend: the account IS premium. Sitting on
    // an error would leave a subscriber staring at a signup form they can't
    // use; refreshing flips the page to its managed state.
    mockCreateSetupIntent.mockRejectedValue(
      new ApiError(409, "already_subscribed", "You already have FinalWhistle Premium."),
    );

    render(<PremiumCheckout plan="monthly" />);

    expect(await screen.findByText(/already have finalwhistle premium/i)).toBeInTheDocument();
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("renders nothing without a publishable key, so the page can fall back", async () => {
    mockPublishableKey = "";

    const { container } = render(<PremiumCheckout plan="monthly" />);

    expect(container).toBeEmptyDOMElement();
    await waitFor(() => expect(mockCreateSetupIntent).not.toHaveBeenCalled());
  });

  it("builds the appearance from the direction G tokens on Stripe's light base", async () => {
    installTokens();
    mockConfirmSetup.mockResolvedValue({ setupIntent: { id: "seti_1" } });

    render(<PremiumCheckout plan="monthly" />);
    expect(await screen.findByTestId("payment-element")).toBeInTheDocument();

    const appearance = mockElementsOptions[mockElementsOptions.length - 1].appearance;
    expect(appearance?.theme).toBe("stripe");
    // The bare triple wrapped into a colour the Appearance API can take.
    expect(appearance?.variables?.colorPrimary).toBe("hsl(161.61 67.39% 18.04%)");
    expect(appearance?.variables?.colorBackground).toBe("hsl(0 0% 100%)");
  });
});
