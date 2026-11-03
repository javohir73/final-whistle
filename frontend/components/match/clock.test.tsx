/** The hydration-safe clock: the first client pass reads what the server
 *  read, then the browser clock takes over. */
import { act, render, screen } from "@testing-library/react";
import { RenderClockContext, useClock, useHydratedNow, useRenderNow } from "./clock";
import { hydrateAcrossTime } from "./hydrate.testutil";

function Show({ now }: { now: Date | null }) {
  return <span data-testid="now">{now ? now.toISOString() : "unknown"}</span>;
}
function ClockProbe() {
  return <Show now={useClock()} />;
}
function HydratedProbe({ serverNow }: { serverNow?: string }) {
  return <Show now={useHydratedNow(serverNow)} />;
}
function RenderNowProbe() {
  return <Show now={useRenderNow()} />;
}

const T0 = new Date("2026-11-08T14:59:00Z");
const T1 = new Date("2026-11-08T15:01:00Z");

afterEach(() => {
  jest.useRealTimers();
  document.body.innerHTML = "";
});

it("is the browser clock on a client-only render, ticking every 30 s", async () => {
  jest.useFakeTimers({ now: T1 });
  render(<ClockProbe />);
  expect(screen.getByTestId("now")).toHaveTextContent(T1.toISOString());
  await act(async () => { jest.advanceTimersByTime(30_000); });
  expect(screen.getByTestId("now")).toHaveTextContent(new Date(T1.getTime() + 30_000).toISOString());
});

it("hydrates server HTML from an earlier instant without a mismatch, then shows the browser clock", async () => {
  jest.useFakeTimers({ now: T0 });
  const { html, container, errors } = await hydrateAcrossTime(
    () => <HydratedProbe serverNow={T0.toISOString()} />,
    T0,
    T1,
  );
  expect(html).toContain(T0.toISOString());
  expect(errors).toEqual([]);
  // One commit later the real clock has taken over.
  expect(container).toHaveTextContent(T1.toISOString());
});

it("without a server instant renders 'unknown' on both sides, then the browser clock", async () => {
  jest.useFakeTimers({ now: T0 });
  const { html, container, errors } = await hydrateAcrossTime(() => <ClockProbe />, T0, T1);
  expect(html).toContain("unknown");
  expect(errors).toEqual([]);
  expect(container).toHaveTextContent(T1.toISOString());
});

it("prefers a list's clock over the browser clock", () => {
  render(
    <RenderClockContext.Provider value={T0}>
      <RenderNowProbe />
    </RenderClockContext.Provider>,
  );
  expect(screen.getByTestId("now")).toHaveTextContent(T0.toISOString());
});
