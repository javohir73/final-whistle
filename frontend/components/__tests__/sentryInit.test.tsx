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

/** The SDK's options, from the first (and only) init in this module. */
async function initOptions() {
  process.env.NEXT_PUBLIC_SENTRY_DSN = "https://public@example.ingest.sentry.io/1";
  render(<SentryInit />);
  await waitFor(() => expect(mockInit).toHaveBeenCalled());
  return mockInit.mock.calls[0][0];
}

describe("breadcrumbs", () => {
  // Breadcrumbs ride along with every event, and the 3DS return URL shows up
  // in them: a history crumb {from, to} when the reader leaves /premium, and
  // fetch/xhr crumbs {url} for requests made from it. Scrubbing only
  // event.request.url left all of these raw.
  it("scrubs client secrets from navigation, fetch and xhr crumbs as they are recorded", async () => {
    const { beforeBreadcrumb } = await initOptions();

    const nav = beforeBreadcrumb({
      category: "navigation",
      data: { from: RETURN_URL.replace("https://finalwhistle.app", ""), to: "/football/epl" },
    });
    expect(nav.data.from).not.toContain("seti_1_secret_XYZ");
    expect(nav.data.from).toContain("setup_intent_client_secret=[redacted]");
    expect(nav.data.to).toBe("/football/epl");

    const fetchCrumb = beforeBreadcrumb({
      category: "fetch",
      data: { url: `${RETURN_URL}&x=1`, method: "GET", status_code: 200 },
    });
    expect(fetchCrumb.data.url).not.toContain("seti_1_secret_XYZ");
    expect(fetchCrumb.data).toMatchObject({ method: "GET", status_code: 200 });

    const xhr = beforeBreadcrumb({ category: "xhr", data: { url: "/api?payment_intent_client_secret=pi_secret" } });
    expect(xhr.data.url).toBe("/api?payment_intent_client_secret=[redacted]");

    const consoleCrumb = beforeBreadcrumb({ category: "console", message: `loaded ${RETURN_URL}` });
    expect(consoleCrumb.message).not.toContain("seti_1_secret_XYZ");

    // Crumbs without data or message pass through untouched.
    expect(beforeBreadcrumb({ category: "ui.click" })).toEqual({ category: "ui.click" });
  });

  it("scrubs crumbs and the Referer header already on an outgoing event", async () => {
    const { beforeSend } = await initOptions();
    const event = beforeSend({
      request: { url: "https://finalwhistle.app/football/epl", headers: { Referer: RETURN_URL, "User-Agent": "UA" } },
      breadcrumbs: [
        { category: "navigation", data: { from: RETURN_URL, to: "/football/epl" } },
        { category: "fetch", data: { url: RETURN_URL } },
      ],
    });
    expect(JSON.stringify(event)).not.toContain("seti_1_secret_XYZ");
    expect(event.request.headers["User-Agent"]).toBe("UA");
    expect(event.breadcrumbs).toHaveLength(2);
  });
});
