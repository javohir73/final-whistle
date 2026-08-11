/** PremiumGate: premium sees children; free/anon see the teaser + CTA;
 *  billing off renders nothing at all. */
import { fireEvent, render, screen } from "@testing-library/react";

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
function renderGate(billingEnabled: boolean) {
  let Gate: React.ComponentType<{ teaser: React.ReactNode; children: React.ReactNode }> =
    () => null;
  jest.isolateModules(() => {
    jest.doMock("@/lib/constants", () => ({
      ...jest.requireActual("@/lib/constants"),
      BILLING_ENABLED: billingEnabled,
    }));
    Gate = require("./PremiumGate").PremiumGate;
  });
  return render(
    <Gate teaser={<div>teaser here</div>}>
      <div>secret markets</div>
    </Gate>,
  );
}

describe("PremiumGate", () => {
  it("renders children for a premium user", () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: true }, loading: false,
                                  openSignIn: jest.fn() });
    renderGate(true);
    expect(screen.getByText("secret markets")).toBeInTheDocument();
    expect(screen.queryByText("teaser here")).not.toBeInTheDocument();
  });

  it("renders teaser + upgrade CTA for a free user", () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: false }, loading: false,
                                  openSignIn: jest.fn() });
    renderGate(true);
    expect(screen.getByText("teaser here")).toBeInTheDocument();
    expect(screen.queryByText("secret markets")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /premium/i }))
      .toHaveAttribute("href", "/premium");
  });

  it("renders teaser with sign-in CTA for anonymous", () => {
    const openSignIn = jest.fn();
    mockUseAuth.mockReturnValue({ user: null, loading: false, openSignIn });
    renderGate(true);
    expect(screen.getByText("teaser here")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /create a free account/i }));
    expect(openSignIn).toHaveBeenCalledWith({ mode: "signup" });
  });

  it("renders nothing when billing is disabled", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, openSignIn: jest.fn() });
    const { container } = renderGate(false);
    expect(container).toBeEmptyDOMElement();
  });
});
