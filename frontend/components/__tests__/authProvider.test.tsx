/** AuthProvider session persistence (FR 4.6): the signed-in UI must survive
 *  reloads and races — a stale pre-login /me result must never sign out a
 *  fresh session, and the cached display hint must paint instantly. */
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import * as session from "@/lib/session";
import { claimNrlTips } from "@/lib/nrlTips";
import { trackEvent } from "@/lib/analytics";

jest.mock("@/lib/session");
jest.mock("@/lib/nrlTips");
jest.mock("@/lib/analytics");
// The modal/toast render real UI; stub them so tests drive auth directly.
jest.mock("@/components/AuthToast", () => ({ AuthToast: () => null }));
jest.mock("@/components/AuthModal", () => ({
  AuthModal: ({ onAuthed }: { onAuthed: (u: unknown, isNew: boolean) => void }) => (
    <button
      type="button"
      onClick={() => onAuthed({ id: 7, email: "p@e.com", display_name: "Pat", avatar_url: null }, false)}
    >
      complete-login
    </button>
  ),
}));

const mockGetMe = session.getMe as jest.Mock;
const mockLoadHint = session.loadUserHint as jest.Mock;
const mockSaveHint = session.saveUserHint as jest.Mock;
const mockClearHint = session.clearUserHint as jest.Mock;

function Probe() {
  const { user, loading } = useAuth();
  return <div data-testid="who">{loading ? "loading:" : ""}{user ? user.display_name : "signed-out"}</div>;
}

beforeEach(() => {
  mockLoadHint.mockReturnValue(null);
  (session.logout as jest.Mock).mockResolvedValue(undefined);
});

afterEach(() => jest.resetAllMocks());

it("keeps the fresh session when a slow pre-login /me 401 resolves after login", async () => {
  // A cached hint is present (expired session), so the mount reconcile fires;
  // /me hangs (cold start) until we resolve it manually — with a 401 (null).
  mockLoadHint.mockReturnValue({ id: 3, email: "old@e.com", display_name: "Old", avatar_url: null });
  let resolveMe!: (u: session.SessionUser | null) => void;
  mockGetMe.mockReturnValue(new Promise((res) => { resolveMe = res; }));

  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  expect(mockGetMe).toHaveBeenCalledTimes(1); // reconcile really is in flight

  // User completes login while the mount-time /me is still in flight.
  fireEvent.click(screen.getByText("complete-login"));
  expect(screen.getByTestId("who")).toHaveTextContent("Pat");

  // The stale pre-login 401 finally lands — it must NOT clear the session.
  await act(async () => { resolveMe(null); });
  expect(screen.getByTestId("who")).toHaveTextContent("Pat");
  expect(mockClearHint).not.toHaveBeenCalled();
});

it("skips /me entirely for a guest with no cached hint and resolves signed-out", async () => {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

  // No hint (beforeEach) → no probe that would only 401, and no loading state.
  await waitFor(() => expect(screen.getByTestId("who")).toHaveTextContent("signed-out"));
  expect(screen.getByTestId("who")).not.toHaveTextContent("loading:");
  expect(mockGetMe).not.toHaveBeenCalled();
});

it("paints instantly from the cached hint, then reconciles with /me", async () => {
  const hinted = { id: 7, email: "p@e.com", display_name: "Pat", avatar_url: null };
  mockLoadHint.mockReturnValue(hinted);
  mockGetMe.mockResolvedValue(hinted);

  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

  // No "Sign in" flash: the hint shows before /me returns.
  expect(screen.getByTestId("who")).toHaveTextContent("Pat");
  await waitFor(() => expect(mockSaveHint).toHaveBeenCalledWith(hinted));
});

it("signs out on a CONFIRMED 401 when no login intervened", async () => {
  mockLoadHint.mockReturnValue({ id: 7, email: "p@e.com", display_name: "Pat", avatar_url: null });
  mockGetMe.mockResolvedValue(null); // confirmed 401

  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

  await waitFor(() => expect(screen.getByTestId("who")).toHaveTextContent("signed-out"));
  expect(mockClearHint).toHaveBeenCalled();
});

it("keeps the current user when /me fails transiently (network/cold start)", async () => {
  mockLoadHint.mockReturnValue({ id: 7, email: "p@e.com", display_name: "Pat", avatar_url: null });
  mockGetMe.mockRejectedValue(new Error("502"));

  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

  await waitFor(() => expect(screen.getByTestId("who")).not.toHaveTextContent("loading:"));
  expect(screen.getByTestId("who")).toHaveTextContent("Pat");
  expect(mockClearHint).not.toHaveBeenCalled();
});

// ---- Merge-on-signup: the device claim runs from here, for every sport -----

const mockClaim = claimNrlTips as jest.MockedFunction<typeof claimNrlTips>;
const mockDeviceId = session.getOrCreateDeviceId as jest.Mock;
const pat = { id: 7, email: "p@e.com", display_name: "Pat", avatar_url: null };

it("merges this device's anonymous picks into the account on sign-in", async () => {
  mockDeviceId.mockReturnValue("device-1");
  mockClaim.mockResolvedValue({ ok: true, handle: "SwiftStriker42", claimed_tips: 3 });

  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  fireEvent.click(screen.getByText("complete-login"));

  await waitFor(() => expect(mockClaim).toHaveBeenCalledWith("device-1"));
  expect(mockClaim).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(trackEvent).toHaveBeenCalledWith("tips_claim", { claimed_tips: 3, trigger: "signin" }),
  );
});

it("re-runs the claim once for a session restored on page load", async () => {
  mockDeviceId.mockReturnValue("device-1");
  mockLoadHint.mockReturnValue(pat);
  mockGetMe.mockResolvedValue(pat);
  mockClaim.mockResolvedValue({ ok: true, handle: "SwiftStriker42", claimed_tips: 0 });

  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

  await waitFor(() => expect(mockClaim).toHaveBeenCalledWith("device-1"));
  // Signing in again as the same account in this page session is a no-op.
  fireEvent.click(screen.getByText("complete-login"));
  await act(async () => {});
  expect(mockClaim).toHaveBeenCalledTimes(1);
});

it("never claims for a guest or an unconfirmed session", async () => {
  mockDeviceId.mockReturnValue("device-1");
  mockLoadHint.mockReturnValue(pat);
  mockGetMe.mockRejectedValue(new Error("502")); // cold start: session unconfirmed

  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

  await waitFor(() => expect(screen.getByTestId("who")).not.toHaveTextContent("loading:"));
  expect(mockClaim).not.toHaveBeenCalled();
});

it("swallows a failed claim without touching the fresh session", async () => {
  mockDeviceId.mockReturnValue("device-1");
  mockClaim.mockRejectedValue(new Error("500"));

  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  fireEvent.click(screen.getByText("complete-login"));

  await waitFor(() => expect(mockClaim).toHaveBeenCalled());
  await act(async () => {});
  expect(screen.getByTestId("who")).toHaveTextContent("Pat");
  expect(trackEvent).not.toHaveBeenCalledWith("tips_claim", expect.anything());
});

it("skips the claim when this browser has no device id (storage blocked)", async () => {
  mockDeviceId.mockReturnValue(null);

  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  fireEvent.click(screen.getByText("complete-login"));

  await act(async () => {});
  expect(mockClaim).not.toHaveBeenCalled();
});
