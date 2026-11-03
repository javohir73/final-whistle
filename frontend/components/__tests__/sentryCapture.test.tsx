/** captureClientError: the error boundaries' path into Sentry. It must be a
 *  silent no-op without a DSN (production ran without one for months), must
 *  never throw into the fallback UI, initializes the SDK at most once (also
 *  when global-error replaced the layout before <SentryInit/> mounted), and
 *  tags the server digest so client and server reports join up. */
import { waitFor } from "@testing-library/react";

const mockInit = jest.fn();
const mockSetTag = jest.fn();
const mockCapture = jest.fn();
jest.mock("@sentry/nextjs", () => ({
  init: (...a: unknown[]) => mockInit(...a),
  setTag: (...a: unknown[]) => mockSetTag(...a),
  captureException: (...a: unknown[]) => mockCapture(...a),
}));

const DSN = "https://public@example.ingest.sentry.io/1";

/** A fresh copy of the module, so its one-shot loader cache starts empty. */
function freshSentryInit(): typeof import("@/components/SentryInit") {
  let mod: typeof import("@/components/SentryInit") | undefined;
  jest.isolateModules(() => {
    mod = require("@/components/SentryInit");
  });
  return mod!;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCapture.mockReset();
  delete (window as { __sentryInited?: boolean }).__sentryInited;
  delete process.env.NEXT_PUBLIC_SENTRY_DSN;
});

it("does nothing without a DSN: no init, no capture, no throw", async () => {
  const { captureClientError, loadSentry } = freshSentryInit();
  expect(() => captureClientError(new Error("boom"))).not.toThrow();
  await expect(loadSentry()).resolves.toBeNull();
  await new Promise((r) => setTimeout(r, 0));
  expect(mockInit).not.toHaveBeenCalled();
  expect(mockCapture).not.toHaveBeenCalled();
});

it("initializes once, tags the model version, and captures with the digest", async () => {
  process.env.NEXT_PUBLIC_SENTRY_DSN = DSN;
  const { captureClientError } = freshSentryInit();
  const serverError = Object.assign(new Error("render failed"), { digest: "2077436543" });
  const clientError = new Error("click handler failed");

  captureClientError(serverError);
  captureClientError(clientError);

  await waitFor(() => expect(mockCapture).toHaveBeenCalledTimes(2));
  expect(mockInit).toHaveBeenCalledTimes(1);
  expect(mockInit.mock.calls[0][0]).toMatchObject({ dsn: DSN, tracesSampleRate: 0 });
  expect(mockSetTag).toHaveBeenCalledWith("model_version", expect.any(String));
  expect(mockCapture).toHaveBeenNthCalledWith(1, serverError, { tags: { digest: "2077436543" } });
  expect(mockCapture).toHaveBeenNthCalledWith(2, clientError, undefined);
});

it("swallows a failing SDK so the error page still renders", async () => {
  process.env.NEXT_PUBLIC_SENTRY_DSN = DSN;
  mockCapture.mockImplementation(() => {
    throw new Error("transport down");
  });
  const { captureClientError } = freshSentryInit();
  expect(() => captureClientError(new Error("x"))).not.toThrow();
  await waitFor(() => expect(mockCapture).toHaveBeenCalled());
});
