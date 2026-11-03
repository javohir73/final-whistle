/** Both error boundaries report to Sentry (via captureClientError, a no-op
 *  without a DSN) instead of only console.error-ing. */
import { render, screen } from "@testing-library/react";
import ErrorPage from "./error";
import GlobalError from "./global-error";

const mockCapture = jest.fn();
jest.mock("@/components/SentryInit", () => ({
  captureClientError: (...a: unknown[]) => mockCapture(...a),
}));

let consoleError: jest.SpyInstance;
beforeEach(() => {
  mockCapture.mockReset();
  // Both boundaries log the error, and rendering <html> inside the test
  // container makes React warn about nesting; neither is under test here.
  consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());

it("app/error.tsx reports the error once and keeps its recovery actions", () => {
  const error = Object.assign(new Error("bad value"), { digest: "d1" });
  render(<ErrorPage error={error} reset={jest.fn()} />);
  expect(mockCapture).toHaveBeenCalledTimes(1);
  expect(mockCapture).toHaveBeenCalledWith(error);
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  // The warning glyph is decorative; the heading says what happened.
  expect(document.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
});

it("app/global-error.tsx reports the error even though the layout is gone", () => {
  const error = new Error("layout crashed");
  render(<GlobalError error={error} reset={jest.fn()} />);
  expect(mockCapture).toHaveBeenCalledWith(error);
});
