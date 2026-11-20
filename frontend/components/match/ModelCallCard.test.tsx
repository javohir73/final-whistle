/** The model's call card and the pure rules behind the pick control. */
import { render, screen, within } from "@testing-library/react";
import { ChanceBar, ModelCallCard } from "./ModelCallCard";
import { agreementLine, draftReady, EMPTY_DRAFT, scoreVerdict, stepDraft, type ModelData } from "./matchPageData";

const data: ModelData = {
  probabilities: { home_win: 0.9216, draw: 0.0609, away_win: 0.0175 },
  predicted: { home: 3, away: 0, probability: 0.13 },
  confidence: "Medium",
  reasons: ["Arsenal has a higher Elo rating."],
  goalMarkets: null,
};

describe("ChanceBar", () => {
  it("prints whole percentages that add to 100 (largest remainder)", () => {
    render(<ChanceBar home="Arsenal" away="Hull City" probabilities={data.probabilities} />);
    expect(screen.getByRole("img", { name: "Arsenal 92%, draw 6%, Hull City 2%" })).toBeInTheDocument();
  });
});

describe("ModelCallCard", () => {
  it("locked: confidence, 'shown because', you vs the model, the bar", () => {
    render(
      <ModelCallCard home="Arsenal" away="Hull City" data={data} mode="locked" result={null}
        pick={{ kind: "score", home: 2, away: 1, points: null, exact: null, gradedAt: null }} />,
    );
    const card = screen.getByRole("region", { name: "The model’s call" });
    expect(within(card).getByText("Medium confidence. Shown because your pick is locked.")).toBeInTheDocument();
    expect(card).toHaveTextContent("You 2–1");
    expect(card).toHaveTextContent("The model’s score 3–0");
    expect(card).toHaveAttribute("id", "forecast");
  });

  it.each([
    [{ home: 3, away: 0 }, "Exact score · 5 points"],
    [{ home: 1, away: 0 }, "Right result · 2 points"],
    [{ home: 0, away: 1 }, "Missed · 0 points"],
  ])("finished %j: grades the model's score with the game's scoring", (result, chip) => {
    render(<ModelCallCard home="Arsenal" away="Hull City" data={data} mode="finished" pick={null} result={result} />);
    expect(screen.getByText("Made before kick-off. Medium confidence.")).toBeInTheDocument();
    expect(screen.getByText(chip)).toBeInTheDocument();
  });

  it("finished with the viewer's graded pick: shows it and its real points", () => {
    render(
      <ModelCallCard home="Arsenal" away="Hull City" data={data} mode="finished" result={{ home: 1, away: 0 }}
        pick={{ kind: "score", home: 2, away: 0, points: 2, exact: false, gradedAt: "2026-11-08T18:00:00Z" }} />,
    );
    expect(screen.getByText(/Your pick/)).toHaveTextContent("Your pick 2–0");
    expect(screen.getAllByText("Right result · 2 points")).toHaveLength(2);
  });

  it("never grades a call before full time", () => {
    render(<ModelCallCard home="Arsenal" away="Hull City" data={data} mode="made" pick={null} result={null} />);
    expect(screen.queryByText(/points/)).not.toBeInTheDocument();
  });
});

describe("pick rules", () => {
  it("starts empty and is not ready", () => {
    expect(EMPTY_DRAFT).toEqual({ home: null, away: null });
    expect(draftReady(EMPTY_DRAFT)).toBe(false);
  });
  it("first tap sets the side (+1 / 0) and an empty other side to 0", () => {
    expect(stepDraft(EMPTY_DRAFT, "home", 1)).toEqual({ home: 1, away: 0 });
    expect(stepDraft(EMPTY_DRAFT, "away", -1)).toEqual({ home: 0, away: 0 });
    expect(stepDraft({ home: 3, away: null }, "away", 1)).toEqual({ home: 3, away: 1 });
  });
  it("then ±1 clamped to 0..15", () => {
    expect(stepDraft({ home: 0, away: 0 }, "home", -1)).toEqual({ home: 0, away: 0 });
    expect(stepDraft({ home: 15, away: 0 }, "home", 1)).toEqual({ home: 15, away: 0 });
    expect(stepDraft({ home: 2, away: 0 }, "home", 1)).toEqual({ home: 3, away: 0 });
  });
  it("says how the pick compares with the model", () => {
    expect(agreementLine({ home: 1, away: 0 }, { home: 1, away: 0 })).toBe("You and the model picked the same score.");
    expect(agreementLine({ home: 2, away: 1 }, { home: 1, away: 0 })).toBe("You and the model agree on the result and differ on the score.");
    expect(agreementLine({ home: 0, away: 1 }, { home: 1, away: 0 })).toBe("You are against the model on this one.");
  });
  it("scores like the game: exact 5, result 2, else 0", () => {
    expect(scoreVerdict({ home: 2, away: 2 }, { home: 2, away: 2 }).points).toBe(5);
    expect(scoreVerdict({ home: 1, away: 1 }, { home: 2, away: 2 }).points).toBe(2);
    expect(scoreVerdict({ home: 1, away: 0 }, { home: 2, away: 2 }).points).toBe(0);
  });
});
