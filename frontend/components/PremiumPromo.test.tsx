/** PremiumPromo — the home-page Premium section. Visible only when billing is
 *  on, the viewer isn't already a subscriber, and the auth check has settled;
 *  in every other state it renders nothing at all. */
import { render, screen } from "@testing-library/react";
import { PREMIUM_FEATURES } from "@/lib/premium";

const mockUseAuth = jest.fn();
jest.mock("@/components/AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
}));

// next/link reads router context via a hook; under jest.isolateModules it gets
// loaded as a second, disconnected copy of React whose hook dispatcher is
// never wired up (crashes with "Cannot read properties of null"). Swap in a
// plain, hook-free <a> for these tests — we only assert on href/text anyway.
jest.mock("next/link", () => {
  const React = require("react");
  return {
    __esModule: true,
    default: function Link({
      href,
      children,
      ...rest
    }: { href: string; children: React.ReactNode }) {
      return React.createElement("a", { href, ...rest }, children);
    },
  };
});

// BILLING_ENABLED is read at import time — evaluate per-test via isolateModules.
function renderPromo(billingEnabled: boolean) {
  let Promo: React.ComponentType = () => null;
  jest.isolateModules(() => {
    jest.doMock("@/lib/constants", () => ({
      ...jest.requireActual("@/lib/constants"),
      BILLING_ENABLED: billingEnabled,
    }));
    Promo = require("./PremiumPromo").PremiumPromo;
  });
  return render(<Promo />);
}

describe("PremiumPromo", () => {
  it("shows the benefits, price and CTA to a signed-in free user", () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: false }, loading: false });
    renderPromo(true);
    // The four benefits come from the shared list /premium renders, so the two
    // surfaces can't describe the tier differently.
    for (const feature of PREMIUM_FEATURES) {
      expect(screen.getByText(feature)).toBeInTheDocument();
    }
    expect(screen.getByText(/\$4\.99\/month or \$39\.99\/year/)).toBeInTheDocument();
    expect(screen.getByText(/7-day free trial/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /see what.s included/i })).toHaveAttribute(
      "href",
      "/premium",
    );
  });

  it("shows the same promo to an anonymous visitor", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });
    renderPromo(true);
    expect(screen.getByRole("link", { name: /see what.s included/i })).toBeInTheDocument();
  });

  it("renders nothing when billing is disabled", () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: false }, loading: false });
    const { container } = renderPromo(false);
    expect(container).toBeEmptyDOMElement();
  });

  it("never sells to an existing subscriber", () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: true }, loading: false });
    const { container } = renderPromo(true);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while auth is still loading", () => {
    // Rather than flash the promo at a subscriber and retract it a tick later.
    mockUseAuth.mockReturnValue({ user: null, loading: true });
    const { container } = renderPromo(true);
    expect(container).toBeEmptyDOMElement();
  });
});
