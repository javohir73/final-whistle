import { render, screen } from "@testing-library/react";
import UfcNotFound from "./not-found";

it("says the page is not here and leads back into the UFC section", () => {
  render(<UfcNotFound />);
  expect(screen.getByRole("heading", { level: 1, name: "That page is not here" })).toBeInTheDocument();
  expect(screen.getByText("The card, fight or fighter may have moved, or the link may be wrong.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Go to the next card" })).toHaveAttribute("href", "/ufc");
  expect(screen.getByRole("link", { name: "All cards" })).toHaveAttribute("href", "/ufc/events");
});

it("never links to the football home page or says matches", () => {
  const { container } = render(<UfcNotFound />);
  for (const a of screen.getAllByRole("link")) expect(a.getAttribute("href")).not.toBe("/");
  expect(container.textContent).not.toMatch(/this week/i);
  expect(container.textContent).not.toMatch(/not affiliated/i);
});
