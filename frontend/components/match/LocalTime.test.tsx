import { render, screen } from "@testing-library/react";
import { asUtcIso, formatLocalStamp, LocalTime } from "./LocalTime";

it("formats a timestamp in the given zone and names the zone", () => {
  // 03:05 UTC on 3 Nov is 2:05 PM in Sydney (AEDT, UTC+11).
  expect(formatLocalStamp("2026-11-03T03:05:00Z", "Australia/Sydney")).toMatch(/^3 Nov, 2:05 PM \S+$/);
  expect(formatLocalStamp("2026-11-03T03:05:00Z", "UTC")).toBe("3 Nov, 3:05 AM UTC");
});

it("reads a naive backend timestamp as UTC", () => {
  expect(asUtcIso("2026-11-03T03:05:00")).toBe("2026-11-03T03:05:00Z");
  expect(asUtcIso("2026-11-03T03:05:00+00:00")).toBe("2026-11-03T03:05:00+00:00");
  expect(formatLocalStamp("2026-11-03T03:05:00", "UTC")).toBe("3 Nov, 3:05 AM UTC");
});

it("renders a <time> element in the reader's chosen zone, carrying the machine-readable instant", () => {
  window.localStorage.setItem("pp:timezone", JSON.stringify({ tz: "Europe/London", confirmed: true }));
  try {
    render(<LocalTime iso="2026-11-03T03:05:00" />);
    expect(screen.getByText(/^3 Nov, 3:05 AM \S+$/)).toHaveAttribute("dateTime", "2026-11-03T03:05:00Z");
  } finally {
    window.localStorage.clear();
  }
});
