/** SentryInit — the Stripe client secret must not leave the page with an error
 *  report. The 3DS return URL carries setup_intent_client_secret, the browser
 *  SDK attaches the full request URL to every event, and that page is where
 *  errors are most likely. */
import { render, waitFor } from "@testing-library/react";

const mockInit = jest.fn();
const mockSetTag = jest.fn();
jest.mock("@sentry/nextjs", () => ({
  init: (...a: unknown[]) => mockInit(...a),
  setTag: (...a: unknown[]) => mockSetTag(...a),
}));

import { SentryInit, scrubClientSecrets } from "@/components/SentryInit";

const RETURN_URL =
  "https://finalwhistle.app/premium?plan=annual&setup_intent=seti_1" +
  "&setup_intent_client_secret=seti_1_secret_XYZ&redirect_status=succeeded";

describe("scrubClientSecrets", () => {
  it("redacts the secret and keeps the rest of the 3DS return URL", () => {
    const scrubbed = scrubClientSecrets(RETURN_URL);
    expect(scrubbed).not.toContain("seti_1_secret_XYZ");
    expect(scrubbed).toContain("setup_intent_client_secret=[redacted]");
    // The non-sensitive params still describe where the error happened.
    expect(scrubbed).toContain("setup_intent=seti_1");
    expect(scrubbed).toContain("redirect_status=succeeded");
    expect(scrubbed).toContain("plan=annual");
  });

  it("handles a relative URL and the payment-intent variant", () => {
    expect(scrubClientSecrets("/premium?payment_intent_client_secret=pi_1_secret_A")).toBe(
      "/premium?payment_intent_client_secret=[redacted]",
    );
  });

  it("leaves an ordinary URL alone", () => {
    expect(scrubClientSecrets("/football/epl?tab=fixtures")).toBe(
      "/football/epl?tab=fixtures",
    );
  });
});

describe("SentryInit", () => {
  it("installs a beforeSend that scrubs the captured URL", async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://public@example.ingest.sentry.io/1";

    render(<SentryInit />);

    await waitFor(() => expect(mockInit).toHaveBeenCalled());
    const { beforeSend } = mockInit.mock.calls[0][0];
    const event = beforeSend({ request: { url: RETURN_URL } });
    expect(event.request.url).not.toContain("seti_1_secret_XYZ");
    // An event with no request context must still pass through untouched.
    expect(beforeSend({})).toEqual({});
  });
});
