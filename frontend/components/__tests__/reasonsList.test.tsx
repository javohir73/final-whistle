import { render, screen } from "@testing-library/react";
import { ReasonsList } from "@/components/ReasonsList";

// Reasons are plain strings with no polarity: some argue FOR the model's
// pick and some AGAINST it. A uniform lime "+" told readers every line
// supported the call, so the marker is a neutral bullet until reasons carry
// a `favors` field.
test("renders each reason with a neutral bullet, never a supporting '+'", () => {
  const reasons = [
    "England rank higher on the model's strength rating.",
    "Home advantage nudges the win probability up.",
    "Norway have won their last three away games.",
  ];
  const { container } = render(<ReasonsList reasons={reasons} />);
  for (const r of reasons) {
    expect(screen.getByText(r)).toBeInTheDocument();
  }
  expect(screen.queryByText("+")).not.toBeInTheDocument();
  const markers = container.querySelectorAll("li > span[aria-hidden]");
  expect(markers).toHaveLength(reasons.length);
  markers.forEach((m) => {
    expect(m).toHaveTextContent("•");
    expect(m).not.toHaveClass("text-lime-deep");
  });
});

test("renders an empty list without throwing when there are no reasons", () => {
  const { container } = render(<ReasonsList reasons={[]} />);
  expect(container.querySelectorAll("li")).toHaveLength(0);
});
