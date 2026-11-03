/** SiteNav — the persistent Premium link. It is rendered alongside ThemeToggle
 *  and AuthButton, outside the five-tab template (lib/sports.ts navTabsFor),
 *  so it is present on unscoped and competition routes alike. It carries the
 *  competition only when the URL names one, and a way back only from a
 *  competition page. */
import { render, screen } from "@testing-library/react";
import type { SessionUser } from "@/lib/session";

jest.mock("@/lib/constants", () => ({
  ...jest.requireActual("@/lib/constants"),
  BILLING_ENABLED: true,
}));

const mockUseAuth = jest.fn();
jest.mock("@/components/AuthProvider", () => ({ useAuth: () => mockUseAuth() }));

let mockPath = "/";
let mockSearch = "";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPath,
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

import { SiteNav } from "@/components/SiteNav";

const freeUser: SessionUser = {
  id: 1,
  email: "pat@example.com",
  display_name: "Pat",
  avatar_url: null,
  premium: false,
};

const auth = (user: SessionUser | null, loading = false) => ({
  user,
  loading,
  openSignIn: jest.fn(),
  logout: jest.fn(),
  deleteAccount: jest.fn(),
});

afterEach(() => {
  mockPath = "/";
  mockSearch = "";
  jest.clearAllMocks();
});

describe("SiteNav — Premium link (billing on)", () => {
  it("points a free user at /premium from the platform home", () => {
    mockUseAuth.mockReturnValue(auth(freeUser));
    mockPath = "/";
    render(<SiteNav />);
    expect(screen.getByRole("link", { name: "Premium" })).toHaveAttribute(
      "href",
      "/premium",
    );
  });

  it("keeps the link on a competition route, with the competition and a way back", () => {
    mockUseAuth.mockReturnValue(auth(freeUser));
    mockPath = "/football/epl";
    render(<SiteNav />);
    expect(screen.getByRole("link", { name: "Premium" })).toHaveAttribute(
      "href",
      "/premium?competition=epl&returnTo=%2Ffootball%2Fepl",
    );
    // The five-tab template still owns the link row itself.
    expect(screen.getByRole("link", { name: "Fixtures" })).toBeInTheDocument();
  });

  it("carries a ?competition= scope but no returnTo from an unscoped route", () => {
    mockUseAuth.mockReturnValue(auth(freeUser));
    mockPath = "/play";
    mockSearch = "competition=nrl";
    render(<SiteNav />);
    expect(screen.getByRole("link", { name: "Premium" })).toHaveAttribute(
      "href",
      "/premium?competition=nrl",
    );
  });

  it("does not stamp a remembered competition onto the link", () => {
    // fw_comp is a preference, not context the visitor gave this page.
    document.cookie = "fw_comp=laliga; Path=/";
    mockUseAuth.mockReturnValue(auth(freeUser));
    mockPath = "/";
    render(<SiteNav />);
    expect(screen.getByRole("link", { name: "Premium" })).toHaveAttribute("href", "/premium");
    document.cookie = "fw_comp=; Max-Age=0; Path=/";
  });

  it("shows the link to an anonymous visitor", () => {
    mockUseAuth.mockReturnValue(auth(null));
    render(<SiteNav />);
    expect(screen.getByRole("link", { name: "Premium" })).toBeInTheDocument();
  });

  it("keeps the link for a subscriber, as the route to managing their billing", () => {
    // It used to return null here, which left /premium — the page carrying the
    // "Manage subscription" button AND the past_due payment-issue banner —
    // unreachable from navigation for the only people paying for it. Their one
    // remaining path was an item inside the avatar dropdown.
    mockUseAuth.mockReturnValue(auth({ ...freeUser, premium: true }));
    render(<SiteNav />);
    const link = screen.getByRole("link", { name: "Premium" });
    expect(link).toHaveAttribute("href", "/premium");
    expect(link).toHaveAttribute("data-member", "true");
  });

  it("marks the same link as a pitch, not a membership, for a free user", () => {
    mockUseAuth.mockReturnValue(auth(freeUser));
    render(<SiteNav />);
    expect(screen.getByRole("link", { name: "Premium" })).toHaveAttribute(
      "data-member",
      "false",
    );
  });

  it("hides the link while the session check is still pending", () => {
    mockUseAuth.mockReturnValue(auth(null, true));
    render(<SiteNav />);
    expect(screen.queryByRole("link", { name: "Premium" })).not.toBeInTheDocument();
  });
});

// BILLING_ENABLED is read at import time and the file-level jest.mock above
// pins it to `true`, so the "billing off" case needs a fresh, isolated require
// of the module graph — and, per the components/AccountMenu.premium.test.tsx
// precedent, an isolated render/screen from that same registry: SiteNav's tree
// (ThemeToggle, AuthButton) uses real hooks, which must come from one copy of
// React.
describe("SiteNav — billing disabled", () => {
  let isolatedRender: typeof render = render;
  let isolatedScreen: typeof screen = screen;
  let IsolatedSiteNav: typeof SiteNav = SiteNav;

  jest.isolateModules(() => {
    jest.resetModules();
    jest.doMock("@/lib/constants", () => ({
      ...jest.requireActual("@/lib/constants"),
      BILLING_ENABLED: false,
    }));
    ({ render: isolatedRender, screen: isolatedScreen } = require("@testing-library/react"));
    ({ SiteNav: IsolatedSiteNav } = require("@/components/SiteNav"));
  });

  it("renders no Premium link at all", () => {
    mockUseAuth.mockReturnValue(auth(freeUser));
    isolatedRender(<IsolatedSiteNav />);
    expect(isolatedScreen.queryByRole("link", { name: "Premium" })).not.toBeInTheDocument();
    // ...and the rest of the bar is untouched.
    expect(isolatedScreen.getByRole("link", { name: "Fixtures" })).toBeInTheDocument();
  });
});
