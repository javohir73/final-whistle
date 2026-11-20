import { render, screen } from "@testing-library/react";
import { ErrorState } from "@/components/States";

it("renders the shared error state as an alert card with readable G text and a retry button", () => {
  const onRetry = jest.fn();
  render(<ErrorState message="The service is unavailable." onRetry={onRetry} />);

  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Something went wrong" })).toHaveClass("text-ink");
  expect(screen.getByText("The service is unavailable.")).toHaveClass("text-ink");
  expect(screen.getByText(/prediction service may be waking up/i).closest("div")).toHaveClass("text-muted");
  screen.getByRole("button", { name: "Try again" }).click();
  expect(onRetry).toHaveBeenCalledTimes(1);
});
