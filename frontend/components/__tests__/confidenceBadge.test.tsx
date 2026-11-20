/** ConfidenceBadge tier tones (direction G): HIGH brand / MEDIUM ink / LOW
 *  muted. Low must never read as "loss". */
import { render, screen } from "@testing-library/react";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";

it.each([
  ["High", "text-brand", "bg-brand-soft"],
  ["Medium", "text-ink", "bg-chip"],
  ["Low", "text-muted", "bg-chip"],
])("paints %s confidence with %s on %s", (level, ink, fill) => {
  render(<ConfidenceBadge level={level} />);
  const badge = screen.getByText(`${level} confidence`);
  expect(badge).toHaveClass(ink, fill);
});

it("never paints Low confidence in the loss (rose) family", () => {
  render(<ConfidenceBadge level="Low" />);
  const badge = screen.getByText("Low confidence");
  expect(badge.className).not.toMatch(/(text|bg)-(loss|miss)/);
});

it("keeps the dot decorative so the tier is read from the word", () => {
  const { container } = render(<ConfidenceBadge level="Low" />);
  expect(container.querySelector("[aria-hidden]")).toBeInTheDocument();
});
