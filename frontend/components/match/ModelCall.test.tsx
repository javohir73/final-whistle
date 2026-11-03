/** ModelCall: the model's call inside the match hero -- one sentence, one
 *  labelled bar, a most-likely-score chip and the confidence tier. */
import { render, screen } from "@testing-library/react";
import { ModelCall } from "./ModelCall";
import type { Verdict } from "@/lib/verdict";

const base = {
  home: "Bournemouth",
  away: "Brentford",
  probabilities: { home_win: 0.519, draw: 0.266, away_win: 0.215 },
  predicted: { home: 1, away: 0, probability: 0.11 },
  confidence: "Medium",
  hasActual: false,
  verdict: null,
};

it("pre-match: one sentence, one bar summing to 100, two chips", () => {
  render(<ModelCall {...base} phase="upcoming" />);
  expect(screen.getByText("Model's call")).toBeInTheDocument();
  expect(screen.getByText("Bournemouth edge it")).toBeInTheDocument();
  expect(screen.getAllByRole("img")).toHaveLength(1);
  expect(screen.getByRole("img")).toHaveAttribute(
    "aria-label",
    "Bournemouth win 52%, draw 27%, Brentford win 21%",
  );
  expect(screen.getByText("Most likely 1–0 · 11%")).toBeInTheDocument();
  expect(screen.getByText("Medium confidence")).toBeInTheDocument();
});

it("live: the bar becomes the labelled in-play win chance and the call shrinks to the pre-match read", () => {
  render(
    <ModelCall
      {...base}
      phase="live"
      hasActual
      liveProbabilities={{ home_win: 0.7, draw: 0.2, away_win: 0.1 }}
    />,
  );
  expect(screen.getByText("Live win chance")).toBeInTheDocument();
  expect(screen.getByText("Pre-match: Bournemouth edge it")).toBeInTheDocument();
  expect(screen.getByRole("img")).toHaveAttribute(
    "aria-label",
    "Bournemouth win 70%, draw 20%, Brentford win 10%",
  );
  expect(screen.getByText("Model predicted 1–0")).toBeInTheDocument();
});

it("grades the call only at a confirmed full time", () => {
  const verdict: Verdict = { kind: "winner", label: "Result predicted right", basis: null, shootout: null };
  const { rerender } = render(<ModelCall {...base} phase="finished" hasActual verdict={verdict} />);
  expect(screen.getByText("Result predicted right")).toBeInTheDocument();

  // A pending result is never graded, and a knockout note no longer applies.
  rerender(<ModelCall {...base} phase="stale" hasActual verdict={null} stage="R16" />);
  expect(screen.queryByText("Result predicted right")).not.toBeInTheDocument();
  expect(screen.queryByText(/Draw = level after 90 minutes/)).not.toBeInTheDocument();
});

it("explains the knockout draw slice before the result is in", () => {
  render(<ModelCall {...base} phase="upcoming" stage="R16" />);
  expect(screen.getByText(/Draw = level after 90 minutes/)).toBeInTheDocument();
});

it("omits the score chip when the model has no scoreline", () => {
  render(<ModelCall {...base} phase="upcoming" predicted={{ home: null, away: null, probability: null }} />);
  expect(screen.queryByText(/Most likely/)).not.toBeInTheDocument();
  expect(screen.getByText("Medium confidence")).toBeInTheDocument();
});
