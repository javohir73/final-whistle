/** PlatformHome — the Premium section as the home page actually renders it.
 *  components/PremiumPromo.test.tsx renders the promo on its own, which says
 *  nothing about whether the page still mounts it: BILLING_ENABLED is unset in
 *  the jest environment, so under app/page.test.tsx the promo returns null and
 *  deleting the <PremiumPromo /> line from PlatformHome breaks no test at all.
 *  This file pins the mount point, and the Explore -> Play -> Premium -> closing
 *  note order the section was specified to sit in. */
import { render, screen } from "@testing-library/react";

jest.mock("@/lib/constants", () => ({
  ...jest.requireActual("@/lib/constants"),
  BILLING_ENABLED: true,
}));

const mockUseAuth = jest.fn();
jest.mock("@/components/AuthProvider", () => ({ useAuth: () => mockUseAuth() }));

import { PlatformHome } from "@/components/PlatformHome";

const freeUser = { user: { id: 1, premium: false }, loading: false };

const closingNote = () => screen.getByText(/Probabilities are published/);
const playCta = () => screen.getByRole("link", { name: /Go to Play/ });
const promoCta = () => screen.queryByRole("link", { name: /see what.s included/i });

/** True when `first` precedes `second` in document order. */
const precedes = (first: Node, second: Node) =>
  Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

afterEach(() => jest.clearAllMocks());

describe("PlatformHome — Premium promo", () => {
  it("carries the promo between the Play panel and the closing note", () => {
    mockUseAuth.mockReturnValue(freeUser);
    render(<PlatformHome />);

    const promo = promoCta();
    expect(promo).toBeInTheDocument();
    expect(screen.getByText("Every market the model prices")).toBeInTheDocument();
    expect(precedes(playCta(), promo!)).toBe(true);
    expect(precedes(promo!, closingNote())).toBe(true);
  });

  it("shows the promo to an anonymous visitor", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });
    render(<PlatformHome />);
    expect(promoCta()).toBeInTheDocument();
  });

  it("drops the section for a subscriber, leaving the rest of the page intact", () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: true }, loading: false });
    render(<PlatformHome />);

    expect(promoCta()).not.toBeInTheDocument();
    expect(screen.queryByText("Every market the model prices")).not.toBeInTheDocument();
    // The promo owns its own top margin, so the page keeps its rhythm.
    expect(playCta()).toBeInTheDocument();
    expect(closingNote()).toBeInTheDocument();
  });
});
