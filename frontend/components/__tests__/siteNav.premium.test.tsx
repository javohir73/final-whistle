/** SiteNav — the persistent Premium link. It is rendered alongside ThemeToggle
 *  and AuthButton, outside both nav-link registries: PLATFORM_LINKS only feeds
 *  platform routes and COMPETITIONS[].navLinks only feeds competition routes,
 *  so a link placed in either would disappear on the other half of the site.
 *  The competition-route case below is that regression. */
import { render, screen } from "@testing-library/react";
import type { SessionUser } from "@/lib/session";

jest.mock("@/lib/constants", () => ({
  ...jest.requireActual("@/lib/constants"),
  BILLING_ENABLED: true,
}));

const mockUseAuth = jest.fn();
jest.mock("@/components/AuthProvider", () => ({ useAuth: () => mockUseAuth() }));

let mockPath = "/";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPath,
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

  it("keeps the link on a competition route, where the platform registry is gone", () => {
    mockUseAuth.mockReturnValue(auth(freeUser));
    mockPath = "/football/epl";
    render(<SiteNav />);
    expect(screen.getByRole("link", { name: "Premium" })).toHaveAttribute(
      "href",
      "/premium",
    );
    // The competition registry still owns the link row itself.
    expect(screen.getByRole("link", { name: "Fixtures" })).toBeInTheDocument();
  });

  it("shows the link to an anonymous visitor", () => {
    mockUseAuth.mockReturnValue(auth(null));
    render(<SiteNav />);
    expect(screen.getByRole("link", { name: "Premium" })).toBeInTheDocument();
  });

  it("hides the link from an existing subscriber", () => {
    mockUseAuth.mockReturnValue(auth({ ...freeUser, premium: true }));
    render(<SiteNav />);
    expect(screen.queryByRole("link", { name: "Premium" })).not.toBeInTheDocument();
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
    expect(isolatedScreen.getByRole("link", { name: "Football" })).toBeInTheDocument();
  });
});
