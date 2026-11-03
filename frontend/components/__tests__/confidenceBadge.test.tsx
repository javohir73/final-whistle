/** ConfidenceBadge tier tones: the same HIGH lime / MEDIUM amber / LOW muted
 *  mapping as ConfidenceRing. Low used to be rose, which read as "loss" and
 *  missed AA on its own wash in both themes. */
import { render, screen } from "@testing-library/react";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";

it.each([
  ["High", "text-lime-deep", "bg-win/15"],
  ["Medium", "text-amber-ink", "bg-draw/15"],
  ["Low", "text-muted", "bg-surface-2"],
])("paints %s confidence with %s on %s", (level, ink, fill) => {
  render(<ConfidenceBadge level={level} />);
  const badge = screen.getByText(`${level} confidence`);
  expect(badge).toHaveClass(ink, fill);
});

it("never paints Low confidence in the loss (rose) family", () => {
  render(<ConfidenceBadge level="Low" />);
  const badge = screen.getByText("Low confidence");
  expect(badge.className).not.toMatch(/(text|bg)-loss/);
});

it("keeps the dot decorative so the tier is read from the word", () => {
  const { container } = render(<ConfidenceBadge level="Low" />);
  expect(container.querySelector("[aria-hidden]")).toBeInTheDocument();
});
