import { render, screen } from "@testing-library/react";
import UfcLayout from "./layout";

it("renders its children and the not-affiliated line", () => {
  render(<UfcLayout><div>child</div></UfcLayout>);
  expect(screen.getByText("child")).toBeInTheDocument();
  expect(screen.getByText("FinalWhistle is not affiliated with the UFC.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Photo credits" })).toHaveAttribute("href", "/ufc/photo-credits");
});
