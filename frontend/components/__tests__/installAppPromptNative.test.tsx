/** The install prompt must never appear inside the Capacitor app. The native
 *  shell loads the live origin in a WKWebView/WebView that is neither
 *  `display-mode: standalone` nor `navigator.standalone`, so engaged users of
 *  the App Store build were told to "Tap Share -> Add to Home Screen". */
import { render, screen, act } from "@testing-library/react";
import { InstallAppPrompt } from "@/components/InstallAppPrompt";
import { recordEngagement } from "@/lib/engagement";
import { __setInstallPromptSettleMs, isNativeShell } from "@/lib/useInstallPrompt";

const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari";
type CapWindow = Window & { Capacitor?: { isNativePlatform?: () => boolean } };

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window.navigator, "userAgent", { value: IOS_UA, configurable: true });
  __setInstallPromptSettleMs(0);
});
afterEach(() => {
  delete (window as CapWindow).Capacitor;
});

/** Engage, then give the (zero) grace period and effects real time to run
 *  before asserting absence -- the control test below proves the same wait
 *  is long enough for the prompt to appear. */
async function engageAndSettle() {
  render(<InstallAppPrompt />);
  act(() => {
    recordEngagement("menu-open");
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

it("detects the native bridge Capacitor injects into the shell", () => {
  expect(isNativeShell()).toBe(false);
  (window as CapWindow).Capacitor = { isNativePlatform: () => true };
  expect(isNativeShell()).toBe(true);
  // Capacitor's web build (a plain browser) reports false.
  (window as CapWindow).Capacitor = { isNativePlatform: () => false };
  expect(isNativeShell()).toBe(false);
});

it("treats a throwing or partial bridge as not native", () => {
  (window as CapWindow).Capacitor = {
    isNativePlatform: () => {
      throw new Error("bridge not ready");
    },
  };
  expect(isNativeShell()).toBe(false);
  (window as CapWindow).Capacitor = {};
  expect(isNativeShell()).toBe(false);
});

it("never shows inside the Capacitor app, even for an engaged iOS user", async () => {
  (window as CapWindow).Capacitor = { isNativePlatform: () => true };
  await engageAndSettle();
  expect(screen.queryByText("Install FinalWhistle")).not.toBeInTheDocument();
});

it("still shows in mobile Safari after the same wait (the control case)", async () => {
  await engageAndSettle();
  expect(screen.getByText("Install FinalWhistle")).toBeInTheDocument();
});
