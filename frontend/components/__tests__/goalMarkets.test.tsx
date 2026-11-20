import { render, screen, within } from "@testing-library/react";
import { GoalMarkets } from "@/components/GoalMarkets";
import type { GoalMarkets as GoalMarketsData } from "@/lib/types";

function markets(): GoalMarketsData {
  return {
    home: { to_score: 0.86, p2: 0.6, p3: 0.45, p4: 0.4 },
    away: { to_score: 0.39, p2: 0.12, p3: 0.03, p4: 0.01 },
    total: { over_1_5: 0.78, over_2_5: 0.5642, over_3_5: 0.3 },
    btts: 0.34,
  };
}

it("lists the four goal chances under one heading (direction G)", () => {
  render(<GoalMarkets home="Argentina" away="Cape Verde" markets={markets()} />);
  const card = screen.getByRole("region", { name: "Goal chances" });
  expect(card).toHaveAttribute("id", "goals");
  const rows = within(card).getAllByRole("listitem").map((li) => li.textContent);
  expect(rows).toEqual([
    "Over 2.5 goals56%",
    "Both teams score34%",
    "Argentina score86%",
    "Cape Verde score39%",
  ]);
});

it("keeps the page calm: no per-team bands or extra totals", () => {
  render(<GoalMarkets home="Argentina" away="Cape Verde" markets={markets()} />);
  expect(screen.queryByText("4+ goals")).not.toBeInTheDocument();
  expect(screen.queryByText(/Over 3.5/)).not.toBeInTheDocument();
});
