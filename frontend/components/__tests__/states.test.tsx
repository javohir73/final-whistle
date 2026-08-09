import { render, screen } from "@testing-library/react";
import { ErrorState } from "@/components/States";

it("uses actual-surface-safe semantic classes for every shared error-state text", () => {
  render(<ErrorState message="The service is unavailable." onRetry={() => undefined} />);

  expect(screen.getByText("Something went wrong")).toHaveClass("text-loss-ink");
  expect(screen.getByText("The service is unavailable.")).toHaveClass("text-muted");
  expect(screen.getByText(/prediction service may be waking up/i)).toHaveClass("text-hint-ink");
  expect(screen.getByRole("button", { name: "Try again" })).toHaveClass("text-pitch");
});
