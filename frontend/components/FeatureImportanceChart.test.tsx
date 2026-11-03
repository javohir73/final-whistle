/** "What drove this prediction": the model's normalized factor weights as a
 *  sorted bar list. It used to be a recharts BarChart, which put ~98 kB gzip of
 *  recharts + lodash on the match page's critical path for five bars; it is now
 *  plain HTML/CSS (no client JS at all) with an sr-only <table> for assistive
 *  tech. Weights are shares of the whole (they sum to 1), so they print as
 *  relative weights, never as "%", which read as a probability. */
import fs from "fs";
import path from "path";
import { render, screen, within } from "@testing-library/react";
import { FeatureImportanceChart } from "@/components/FeatureImportanceChart";

const FEATURES = [
  { name: "form_last10", weight: 0.2 },
  { name: "elo_gap", weight: 0.66 },
  { name: "head_to_head", weight: 0.14 },
];

describe("FeatureImportanceChart", () => {
  it("gives assistive tech a labelled table of factor and relative weight", () => {
    render(<FeatureImportanceChart features={FEATURES} />);
    const table = screen.getByRole("table", { name: /relative weight/i });
    expect(table).toHaveClass("sr-only");
    expect(within(table).getAllByRole("columnheader").map((c) => c.textContent)).toEqual([
      "Factor",
      "Relative weight",
    ]);
    // Friendly labels, sorted by weight, values as shares of 1 -- never "%".
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      "Elo gap0.66",
      "Recent form0.20",
      "Head-to-head0.14",
    ]);
    expect(within(table).getByRole("rowheader", { name: "Elo gap" })).toBeInTheDocument();
    expect(table.textContent).not.toContain("%");
  });

  it("draws the visual bar list sorted, proportional, and hidden from AT", () => {
    const { container } = render(<FeatureImportanceChart features={FEATURES} />);
    const list = container.querySelector("[data-feature-bars]") as HTMLElement;
    expect(list).toHaveAttribute("aria-hidden", "true");
    const bars = [...list.querySelectorAll<HTMLElement>("[data-weight]")];
    expect(bars.map((b) => b.dataset.weight)).toEqual(["0.66", "0.2", "0.14"]);
    expect(bars.map((b) => b.style.width)).toEqual(["66%", "20%", "14%"]);
    expect(list.textContent).toContain("Elo gap");
    expect(list.textContent).toContain("0.66");
    expect(list.textContent).not.toContain("%");
  });

  it("states the unit visibly", () => {
    render(<FeatureImportanceChart features={FEATURES} />);
    expect(screen.getByText(/relative weight/i, { selector: "p" })).toBeInTheDocument();
  });

  it("labels the v2 form-channels factor and falls back to the raw key", () => {
    render(
      <FeatureImportanceChart
        features={[
          { name: "form_channels", weight: 0.5 },
          { name: "mystery_factor", weight: 0.5 },
        ]}
      />,
    );
    const table = screen.getByRole("table");
    expect(within(table).getByRole("rowheader", { name: "Attack/defence form" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "mystery_factor" })).toBeInTheDocument();
  });

  it("clamps out-of-range weights instead of drawing past the track", () => {
    const { container } = render(
      <FeatureImportanceChart features={[{ name: "elo_gap", weight: 1.4 }, { name: "head_to_head", weight: -0.2 }]} />,
    );
    const widths = [...container.querySelectorAll<HTMLElement>("[data-weight]")].map((b) => b.style.width);
    expect(widths).toEqual(["100%", "0%"]);
  });

  it("renders nothing when there are no features", () => {
    const { container } = render(<FeatureImportanceChart features={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("stays off recharts and off the client bundle", () => {
    const source = fs.readFileSync(path.join(__dirname, "FeatureImportanceChart.tsx"), "utf8");
    expect(source).not.toMatch(/from\s+["']recharts["']/);
    expect(source).not.toMatch(/^\s*["']use client["']/m);
  });
});
