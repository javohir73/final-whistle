/** There is no theme control any more: direction G is the only theme.
 *  (This file used to test the Floodlight/Daylight ThemeToggle.) The header
 *  must not offer a theme switch, and nothing it renders may flip the
 *  document into another theme. */
import { render, screen } from "@testing-library/react";
import { SiteNav } from "@/components/SiteNav";

const mockPathname = jest.fn(() => "/football/epl");
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));
jest.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: null, loading: false, openSignIn: jest.fn() }),
}));

it("offers no theme switch in the header", () => {
  render(<SiteNav />);
  expect(screen.queryByRole("button", { name: /theme/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
});

it("leaves the document in the one light theme", () => {
  render(<SiteNav />);
  expect(document.documentElement.className).not.toMatch(/theme-/);
  expect(window.localStorage.getItem("fw_theme")).toBeNull();
});
