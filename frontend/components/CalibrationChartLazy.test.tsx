/** CalibrationChartLazy: recharts (~98 kB gzip with lodash) leaves the first
 *  load of /methodology and /record. The chart chunk loads after hydration
 *  (next/dynamic, ssr:false) behind a same-size skeleton, and the numbers are
 *  in the server HTML from the start as an sr-only table. */
import { render, screen, within } from "@testing-library/react";
import { CalibrationChartLazy } from "@/components/CalibrationChartLazy";

jest.mock("@/components/CalibrationChart", () => ({
  CalibrationChart: ({ bins }: { bins: unknown[] }) => (
    <div data-testid="recharts-calibration" data-points={bins.length} />
  ),
}));

const BINS = [
  { mean_predicted: 0.1, empirical_freq: 0.08, count: 40 },
  { mean_predicted: 0.5, empirical_freq: 0.52, count: 120 },
  { mean_predicted: 0.9, empirical_freq: 0.93, count: 35 },
];

it("reserves the chart's 300px box with a skeleton, then swaps in the chart", async () => {
  const { container } = render(<CalibrationChartLazy bins={BINS} />);
  const skeleton = container.querySelector(".skeleton") as HTMLElement | null;
  expect(skeleton).not.toBeNull();
  expect(skeleton!.style.height).toBe("300px");

  const chart = await screen.findByTestId("recharts-calibration");
  expect(chart).toHaveAttribute("data-points", "3");
  expect(container.querySelector(".skeleton")).toBeNull();
  // The drawn chart is decorative for AT; the table below carries the data.
  expect(chart.closest("[aria-hidden]")).toHaveAttribute("aria-hidden", "true");
});

it("exposes every bin to assistive tech as an sr-only table", () => {
  render(<CalibrationChartLazy bins={BINS} />);
  const table = screen.getByRole("table", { name: /calibration/i });
  expect(table).toHaveClass("sr-only");
  expect(within(table).getAllByRole("columnheader").map((c) => c.textContent)).toEqual([
    "Predicted",
    "Actually happened",
    "Forecasts",
  ]);
  const rows = within(table).getAllByRole("row").slice(1);
  expect(rows.map((r) => r.textContent)).toEqual(["10%8%40", "50%52%120", "90%93%35"]);
});
