/** WinProbTimeline (Floodlight P4 slice p4-s1): the match centre's win-probability
 *  chart. For football it renders the model's PRE-MATCH forecast trajectory as a
 *  pure, server-renderable SVG (role="img" with a printed-% aria-label as the
 *  accessible source of truth). With fewer than two points there is no
 *  trajectory, and it renders NOTHING: the hero already carries the one W/D/L
 *  bar, so a single-bar fallback here was a duplicate, never a chart. The axis
 *  only says "KO" once kickoff has actually passed. */
import { render, screen } from "@testing-library/react";
import { WinProbTimeline } from "@/components/WinProbTimeline";
import type { ProbHistoryPoint } from "@/lib/types";

function makePoints(homeSeries: number[], withDates = true): ProbHistoryPoint[] {
  return homeSeries.map((p_home, i) => ({
    date: withDates ? `2026-07-${String(i + 1).padStart(2, "0")}` : null,
    p_home,
    p_draw: (1 - p_home) / 2,
    p_away: (1 - p_home) / 2,
  }));
}

const BEFORE_KICKOFF = new Date("2026-07-05T12:00:00Z");
const AFTER_KICKOFF = new Date("2026-07-06T22:00:00Z");
const KICKOFF = "2026-07-06T19:00:00Z";

describe("WinProbTimeline", () => {
  it("renders an svg[role=img] with the printed current % in its aria-label and a trajectory path", () => {
    const { container } = render(
      <WinProbTimeline
        points={makePoints([0.5, 0.55, 0.6, 0.66])}
        homeLabel="Brazil"
        kickoffUtc={KICKOFF}
        now={BEFORE_KICKOFF}
      />,
    );

    const svg = screen.getByRole("img");
    expect(svg.tagName.toLowerCase()).toBe("svg");
    // The printed current % (last p_home = 66%) is the accessible source of truth.
    expect(svg).toHaveAttribute("aria-label", expect.stringContaining("66%"));
    expect(svg).toHaveAttribute("aria-label", expect.stringContaining("Brazil"));

    // A real trajectory path is drawn.
    const path = container.querySelector("path");
    expect(path).not.toBeNull();
    expect(path).toHaveAttribute("d", expect.stringContaining("M"));
  });

  it("ends a pre-kickoff forecast at 'Latest · {date}', never 'KO'", () => {
    render(
      <WinProbTimeline
        points={makePoints([0.5, 0.55, 0.6, 0.66])}
        homeLabel="Brazil"
        kickoffUtc={KICKOFF}
        now={BEFORE_KICKOFF}
      />,
    );
    expect(screen.getByText("Latest · 4 Jul")).toBeInTheDocument();
    expect(screen.queryByText("KO")).not.toBeInTheDocument();
  });

  it("ends at KO once kickoff has passed", () => {
    render(
      <WinProbTimeline
        points={makePoints([0.5, 0.55, 0.6, 0.66])}
        homeLabel="Brazil"
        kickoffUtc={KICKOFF}
        now={AFTER_KICKOFF}
      />,
    );
    expect(screen.getByText("KO")).toBeInTheDocument();
    expect(screen.queryByText(/^Latest/)).not.toBeInTheDocument();
  });

  it("never claims KO when the kickoff is unknown", () => {
    render(<WinProbTimeline points={makePoints([0.5, 0.6])} homeLabel="Brazil" kickoffUtc={null} />);
    expect(screen.getByText("Latest · 2 Jul")).toBeInTheDocument();
    expect(screen.queryByText("KO")).not.toBeInTheDocument();
  });

  it("keeps the honest EARLIER…NOW steps for an undated series", () => {
    render(<WinProbTimeline points={makePoints([0.5, 0.6], false)} homeLabel="Brazil" />);
    expect(screen.getByText("EARLIER")).toBeInTheDocument();
    expect(screen.getByText("NOW")).toBeInTheDocument();
  });

  it("draws one marker circle per marker, on top of the current-point dot", () => {
    const { container } = render(
      <WinProbTimeline
        points={makePoints([0.5, 0.55, 0.6, 0.66])}
        homeLabel="Brazil"
        markers={[
          { at: 0.25, tone: "home" },
          { at: 0.6, tone: "away" },
        ]}
      />,
    );

    // Two markers + the always-present current-point dot.
    const circles = container.querySelectorAll("circle");
    expect(circles).toHaveLength(3);
    // Marker tone maps to the ring color, never fill/color alone.
    expect(container.querySelector("circle.stroke-loss")).not.toBeNull();
  });

  it.each([[[0.62]], [[]]])("renders nothing at all for %p points — no fallback bar, no fake chart", (series) => {
    const { container } = render(<WinProbTimeline points={makePoints(series)} homeLabel="Brazil" />);
    expect(container).toBeEmptyDOMElement();
  });
});
