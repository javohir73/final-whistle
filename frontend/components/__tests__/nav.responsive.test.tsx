/** Header/tab-bar responsive contract.
 *
 *  The bug: at 390px the document measured 444px wide and the anonymous
 *  "Sign in" button sat at x=444, entirely outside the viewport. Two separate
 *  causes, both pinned here:
 *
 *  1. Every header item was shrink-0 and nothing dropped on small screens, so
 *     the brand wordmark (~100px) and the competition switcher's text label
 *     (~40px) held the nav above 440px no matter the viewport. Only reproduces
 *     with BILLING_ENABLED — the Premium link is the last ~76px — which is why
 *     it never showed up locally.
 *
 *  2. The header link row was `hidden sm:flex` while BottomNav was `sm:hidden`.
 *     That row needs ~450px on its own, so from 640px to 1023px the header
 *     rendered a 903px-wide nav. The two must swap at the SAME breakpoint or a
 *     width band gets both or neither.
 *
 *  jsdom has no layout engine, so these assert the class contract that
 *  produces the layout. The pixel measurements themselves were taken in a real
 *  browser at 320/390/768/1280 and are recorded in the PR.
 */
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
  useSearchParams: () => new URLSearchParams(),
}));

import { BottomNav } from "@/components/BottomNav";
import { SiteNav } from "@/components/SiteNav";

const anonymous = {
  user: null as SessionUser | null,
  loading: false,
  openSignIn: jest.fn(),
  logout: jest.fn(),
  deleteAccount: jest.fn(),
};

beforeEach(() => mockUseAuth.mockReturnValue(anonymous));
afterEach(() => {
  mockPath = "/";
  jest.clearAllMocks();
});

/** Tailwind responsive prefix guarding an element, e.g. "lg" from "lg:hidden". */
const breakpointOf = (cls: string, suffix: string): string | null => {
  const hit = cls.split(/\s+/).find((c) => c.endsWith(`:${suffix}`));
  return hit ? hit.split(":")[0] : null;
};

describe("primary navigation swaps at one breakpoint", () => {
  it("hands off from the tab bar to the header row at the same width", () => {
    // THE regression. If these two ever disagree again, one viewport band
    // shows both navigations or none.
    mockPath = "/football/epl";
    const { container: headerEl } = render(<SiteNav />);
    const row = headerEl.querySelector("header nav > div");
    const rowBreakpoint = breakpointOf(row?.className ?? "", "flex");

    const { container: bottomEl } = render(<BottomNav />);
    const bar = bottomEl.querySelector('nav[aria-label="Primary"]');
    const barBreakpoint = breakpointOf(bar?.className ?? "", "hidden");

    expect(rowBreakpoint).toBe(barBreakpoint);
  });

  it("puts that handoff at lg, where the header row actually fits", () => {
    // sm (640px) was the old value and is what produced the 903px nav at 768.
    mockPath = "/football/epl";
    const { container } = render(<SiteNav />);
    const row = container.querySelector("header nav > div");
    expect(row).toHaveClass("hidden", "lg:flex");
    expect(row).not.toHaveClass("sm:flex");
  });
});

describe("Sign in is always reachable", () => {
  it.each(["/", "/football/epl", "/football/laliga", "/nrl"])(
    "renders an un-hidden Sign in control on %s",
    (path) => {
      mockPath = path;
      render(<SiteNav />);
      const signIn = screen.getByRole("button", { name: "Sign in" });
      // Never behind a responsive `hidden` — it was pushed off-screen by
      // siblings, and hiding it would be the wrong fix for that.
      expect(signIn.className).not.toMatch(/(^|\s)hidden(\s|$)/);
      expect(signIn.className).not.toMatch(/:hidden/);
    },
  );
});

describe("small screens drop text, never controls", () => {
  it("hides the wordmark below sm but keeps the link's accessible name", () => {
    mockPath = "/";
    render(<SiteNav />);
    const home = screen.getByRole("link", { name: "FinalWhistle home" });
    const wordmark = home.querySelector("span");
    expect(wordmark).toHaveClass("hidden", "sm:inline");
    // The mark itself never drops — that is the brand identity.
    expect(home.querySelector("svg")).toBeTruthy();
  });

  it("keeps the Premium link visible on mobile", () => {
    // It contributes to the overflow, but the discovery work exists precisely
    // to make Premium reachable — narrowing it is fine, hiding it is not.
    mockPath = "/football/epl";
    render(<SiteNav />);
    const premium = screen.getByRole("link", { name: "Premium" });
    expect(premium.className).not.toMatch(/:hidden/);
    expect(premium.className).not.toMatch(/(^|\s)hidden(\s|$)/);
  });
});
