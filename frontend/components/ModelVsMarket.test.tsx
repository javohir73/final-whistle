/** ModelVsMarket: one row on the match page comparing the model's favoured
 *  outcome with the bookmaker consensus on the same outcome. It used to draw
 *  two more W/D/L bars -- the third and fourth copies of the same split on the
 *  page -- so it is now a single line, and a single line when unavailable. */
import { render, screen } from "@testing-library/react";
import { ModelVsMarket } from "./ModelVsMarket";
import type { Prediction } from "@/lib/types";

const base = {
  match_id: 99,
  probabilities: { home_win: 0.25, draw: 0.29, away_win: 0.46 },
} as unknown as Prediction;

describe("ModelVsMarket", () => {
  it("compares the model's favoured outcome with the market in one row, no bars", () => {
    const p = {
      ...base,
      odds_comparison: {
        available: true,
        market: { home_win: 0.22, draw: 0.27, away_win: 0.51 },
        captured_at: "2026-07-08T10:00:00+00:00",
      },
    } as Prediction;
    const { container } = render(<ModelVsMarket prediction={p} home="Norway" away="England" />);

    expect(screen.getByText("Model vs market")).toBeInTheDocument();
    // England is the model's pick (46%); the market has them at 51%.
    expect(container).toHaveTextContent("England: model 46% · market 51% (model −5 pts)");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/Not betting advice/)).toBeInTheDocument();
  });

  it("signs a model edge with a plus", () => {
    const p = {
      ...base,
      odds_comparison: { available: true, market: { home_win: 0.3, draw: 0.3, away_win: 0.4 } },
    } as Prediction;
    const { container } = render(<ModelVsMarket prediction={p} home="Norway" away="England" />);
    expect(container).toHaveTextContent("England: model 46% · market 40% (model +6 pts)");
  });

  it("says so in one line when there is no market snapshot", () => {
    const p = { ...base, odds_comparison: { available: false } } as Prediction;
    const { container } = render(<ModelVsMarket prediction={p} home="Norway" away="England" />);
    expect(screen.getByText(/Market consensus isn.t available for this fixture yet/i)).toBeInTheDocument();
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector("section")).toBeNull();
  });
});
