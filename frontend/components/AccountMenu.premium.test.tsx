/** AccountMenu — "Manage subscription" menu item. Shown only when billing is
 *  enabled AND the user is premium or has a non-canceled subscription status; calls createPortalSession() and navigates
 *  to the returned billing-portal URL. Errors are swallowed quietly so the
 *  menu stays usable (no error banner inside the account menu). */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SessionUser } from "@/lib/session";

jest.mock("@/lib/constants", () => ({
  ...jest.requireActual("@/lib/constants"),
  BILLING_ENABLED: true,
}));

const mockCreatePortalSession = jest.fn();
jest.mock("@/lib/session", () => ({
  ...jest.requireActual("@/lib/session"),
  createPortalSession: (...a: unknown[]) => mockCreatePortalSession(...a),
}));

import { AccountMenu } from "./AccountMenu";

const premiumUser: SessionUser = {
  id: 1,
  email: "pat@example.com",
  display_name: "Pat",
  avatar_url: null,
  premium: true,
};
const freeUser: SessionUser = { ...premiumUser, premium: false };

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: /account: pat/i }));
}

describe("AccountMenu — Manage subscription (billing on)", () => {
  // window.location gets stubbed (redirect assertions) in some tests below —
  // capture and restore the real one so a later `Object.defineProperty`
  // redefinition never throws ("Cannot redefine property").
  const originalLocation = window.location;

  beforeEach(() => jest.clearAllMocks());
  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it("shows Manage subscription for a premium user", () => {
    render(<AccountMenu user={premiumUser} onLogout={jest.fn()} onDeleteAccount={jest.fn()} />);
    openMenu();
    expect(screen.getByRole("menuitem", { name: /manage subscription/i })).toBeInTheDocument();
  });

  it("does not show Manage subscription for a non-premium user", () => {
    render(<AccountMenu user={freeUser} onLogout={jest.fn()} onDeleteAccount={jest.fn()} />);
    openMenu();
    expect(screen.queryByText(/manage subscription/i)).not.toBeInTheDocument();
  });

  it("shows Manage subscription for a lapsed payer (past_due, premium false)", () => {
    const user = { ...freeUser, premium_status: "past_due" };
    render(<AccountMenu user={user} onLogout={jest.fn()} onDeleteAccount={jest.fn()} />);
    openMenu();
    expect(screen.getByRole("menuitem", { name: /manage subscription/i })).toBeInTheDocument();
  });

  it.each(["unpaid", "incomplete"])("shows Manage subscription for status %s", (status) => {
    const user = { ...freeUser, premium_status: status };
    render(<AccountMenu user={user} onLogout={jest.fn()} onDeleteAccount={jest.fn()} />);
    openMenu();
    expect(screen.getByRole("menuitem", { name: /manage subscription/i })).toBeInTheDocument();
  });

  it("does not show Manage subscription for a canceled subscription", () => {
    const user = { ...freeUser, premium_status: "canceled" };
    render(<AccountMenu user={user} onLogout={jest.fn()} onDeleteAccount={jest.fn()} />);
    openMenu();
    expect(screen.queryByText(/manage subscription/i)).not.toBeInTheDocument();
  });

  it("does not show Manage subscription for null status and premium false", () => {
    const user = { ...freeUser, premium_status: null };
    render(<AccountMenu user={user} onLogout={jest.fn()} onDeleteAccount={jest.fn()} />);
    openMenu();
    expect(screen.queryByText(/manage subscription/i)).not.toBeInTheDocument();
  });

  it("does not show Manage subscription for an empty status", () => {
    const user = { ...freeUser, premium_status: "" };
    render(<AccountMenu user={user} onLogout={jest.fn()} onDeleteAccount={jest.fn()} />);
    openMenu();
    expect(screen.queryByText(/manage subscription/i)).not.toBeInTheDocument();
  });

  it("navigates to the billing portal url on click", async () => {
    mockCreatePortalSession.mockResolvedValue({ url: "https://billing.stripe.test/portal" });
    const assignSpy = jest.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignSpy },
      writable: true,
      configurable: true,
    });
    render(<AccountMenu user={premiumUser} onLogout={jest.fn()} onDeleteAccount={jest.fn()} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /manage subscription/i }));
    await waitFor(() => expect(mockCreatePortalSession).toHaveBeenCalled());
    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith("https://billing.stripe.test/portal"));
  });

  it("swallows portal errors and leaves the menu usable", async () => {
    mockCreatePortalSession.mockRejectedValue(new Error("boom"));
    const assignSpy = jest.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignSpy },
      writable: true,
      configurable: true,
    });
    render(<AccountMenu user={premiumUser} onLogout={jest.fn()} onDeleteAccount={jest.fn()} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /manage subscription/i }));
    await waitFor(() => expect(mockCreatePortalSession).toHaveBeenCalled());
    expect(assignSpy).not.toHaveBeenCalled();
    // menu stays open/usable — its other items are still there and clickable.
    expect(screen.getByRole("menuitem", { name: /sign out/i })).toBeInTheDocument();
  });
});

// BILLING_ENABLED is read at import time, and the file-level jest.mock above
// fixes it to `true` for every test in the block above — so proving the
// "billing off" behavior needs a fresh, isolated require of the module graph
// with a different mocked value (jest.isolateModules). AccountMenu uses real
// useState/useEffect/useRef (not just a mocked hook), so the isolated
// component must be rendered with an isolated `render`/`screen`/`fireEvent`
// too, keeping every piece (react, react-dom, the component's own hooks) from
// the same sandboxed module registry.
describe("AccountMenu — billing disabled", () => {
  let isolatedRender: typeof render = render;
  let isolatedScreen: typeof screen = screen;
  let isolatedFireEvent: typeof fireEvent = fireEvent;
  let IsolatedAccountMenu: typeof AccountMenu = AccountMenu;

  jest.isolateModules(() => {
    jest.resetModules();
    jest.doMock("@/lib/constants", () => ({
      ...jest.requireActual("@/lib/constants"),
      BILLING_ENABLED: false,
    }));
    ({ render: isolatedRender, screen: isolatedScreen, fireEvent: isolatedFireEvent } =
      require("@testing-library/react"));
    ({ AccountMenu: IsolatedAccountMenu } = require("./AccountMenu"));
  });

  it("hides Manage subscription even for a premium user", () => {
    isolatedRender(
      <IsolatedAccountMenu user={premiumUser} onLogout={jest.fn()} onDeleteAccount={jest.fn()} />,
    );
    isolatedFireEvent.click(isolatedScreen.getByRole("button", { name: /account: pat/i }));
    expect(isolatedScreen.queryByText(/manage subscription/i)).not.toBeInTheDocument();
  });

  it("hides Manage subscription for a past_due user too", () => {
    isolatedRender(
      <IsolatedAccountMenu
        user={{ ...freeUser, premium_status: "past_due" }}
        onLogout={jest.fn()}
        onDeleteAccount={jest.fn()}
      />,
    );
    isolatedFireEvent.click(isolatedScreen.getByRole("button", { name: /account: pat/i }));
    expect(isolatedScreen.queryByText(/manage subscription/i)).not.toBeInTheDocument();
  });
});
