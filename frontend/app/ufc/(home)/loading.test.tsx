import fs from "fs";
import path from "path";
import { render, screen } from "@testing-library/react";
import UfcHomeLoading from "./loading";

it("announces a single 'Loading…' status", () => {
  render(<UfcHomeLoading />);
  expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading…");
});

it("renders shimmer placeholders", () => {
  const { container } = render(<UfcHomeLoading />);
  expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
});

// A loading.tsx directly in app/ufc would wrap every nested by-key layout in
// Suspense, so their notFound() would stream as HTTP 200 (a soft 404). The home
// page's boundary lives in the (home) route group so it covers only /ufc.
it("has no loading.tsx at the top of app/ufc", () => {
  expect(fs.existsSync(path.join(__dirname, "..", "loading.tsx"))).toBe(false);
});
