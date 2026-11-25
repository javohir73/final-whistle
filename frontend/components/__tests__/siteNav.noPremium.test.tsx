/** The header carries no Premium link, even with the billing flag on (the
 *  flag now only gates the account menu's "Manage subscription" item). */
import { render, screen } from "@testing-library/react";

jest.mock("@/lib/constants", () => ({
  ...jest.requireActual("@/lib/constants"),
  BILLING_ENABLED: true,
}));

jest.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: 1, email: "pat@example.com", display_name: "Pat", avatar_url: null, premium: true },
    loading: false,
    openSignIn: jest.fn(),
    logout: jest.fn(),
    deleteAccount: jest.fn(),
  }),
}));

let mockPath = "/";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPath,
  useSearchParams: () => new URLSearchParams(),
}));

import { SiteNav } from "@/components/SiteNav";

it.each(["/", "/football/epl", "/nrl"])("has no Premium link on %s", (path) => {
  mockPath = path;
  const { container } = render(<SiteNav />);
  expect(screen.queryByRole("link", { name: /premium/i })).toBeNull();
  expect(container.querySelector('a[href^="/premium"]')).toBeNull();
});
