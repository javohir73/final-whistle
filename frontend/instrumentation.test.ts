/** instrumentation.ts: server-side Sentry, inert without a DSN. */
const mockInit = jest.fn();
const mockCaptureRequestError = jest.fn();
jest.mock("@sentry/nextjs", () => ({
  init: (...a: unknown[]) => mockInit(...a),
  captureRequestError: (...a: unknown[]) => mockCaptureRequestError(...a),
}));

import { onRequestError, register } from "./instrumentation";

const ENV = { ...process.env };
const request = { path: "/football/epl/match/7", method: "GET", headers: {} };
const context = {
  routerKind: "App Router",
  routePath: "/football/[comp]/match/[id]",
  routeType: "render",
  revalidateReason: undefined,
} as const;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV };
  delete process.env.SENTRY_DSN;
  delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  process.env.NEXT_RUNTIME = "nodejs";
});
afterAll(() => {
  process.env = ENV;
});

it("does nothing at all without a DSN", async () => {
  await register();
  await onRequestError(new Error("boom"), request, context);
  expect(mockInit).not.toHaveBeenCalled();
  expect(mockCaptureRequestError).not.toHaveBeenCalled();
});

it("initializes the server SDK with the model-version tag when a DSN is set", async () => {
  process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/2";
  await register();
  expect(mockInit).toHaveBeenCalledTimes(1);
  const options = mockInit.mock.calls[0][0];
  expect(options).toMatchObject({
    dsn: "https://public@example.ingest.sentry.io/2",
    tracesSampleRate: 0,
    initialScope: { tags: { model_version: expect.any(String) } },
  });
});

it("falls back to the browser DSN so one variable turns on both sides", async () => {
  process.env.NEXT_PUBLIC_SENTRY_DSN = "https://public@example.ingest.sentry.io/3";
  await register();
  expect(mockInit.mock.calls[0][0].dsn).toBe("https://public@example.ingest.sentry.io/3");
});

it("forwards request errors to captureRequestError", async () => {
  process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/2";
  const error = new Error("server component threw");
  await onRequestError(error, request, context);
  expect(mockCaptureRequestError).toHaveBeenCalledWith(error, request, context);
});

it("never throws from onRequestError", async () => {
  process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/2";
  mockCaptureRequestError.mockImplementation(() => {
    throw new Error("transport down");
  });
  await expect(onRequestError(new Error("x"), request, context)).resolves.toBeUndefined();
});

it("strips cookies/auth headers and Stripe client secrets before sending", async () => {
  process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/2";
  await register();
  const { beforeSend } = mockInit.mock.calls[0][0];
  const event = beforeSend({
    request: {
      url: "https://x.app/premium?setup_intent=seti_1&setup_intent_client_secret=seti_1_secret_Z",
      query_string: "setup_intent_client_secret=seti_1_secret_Z",
      cookies: { fw_session: "s3cret" },
      headers: { Cookie: "fw_session=s3cret", Authorization: "Bearer t", "user-agent": "UA" },
    },
    contexts: { nextjs: { request_path: "/premium?payment_intent_client_secret=pi_secret" } },
  });
  expect(event.request.cookies).toBeUndefined();
  expect(event.request.headers).toEqual({ "user-agent": "UA" });
  expect(event.request.url).not.toContain("seti_1_secret_Z");
  expect(event.request.query_string).toBe("setup_intent_client_secret=[redacted]");
  expect(event.contexts.nextjs.request_path).toBe("/premium?payment_intent_client_secret=[redacted]");
});
