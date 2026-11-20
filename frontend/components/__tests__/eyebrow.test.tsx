import { render, screen } from "@testing-library/react";
import { Eyebrow, CompEyebrowChip } from "@/components/Eyebrow";
import { COMPETITIONS } from "@/lib/sports";

describe("Eyebrow", () => {
  it("renders the direction G eyebrow: sentence case, 15px notes size, muted", () => {
    render(<Eyebrow>Tonight feature</Eyebrow>);
    const label = screen.getByText("Tonight feature");
    expect(label).not.toHaveClass("uppercase");
    expect(label).toHaveClass("text-notes", "font-medium", "text-muted");
  });
});

describe("CompEyebrowChip", () => {
  it.each(Object.values(COMPETITIONS))(
    "renders $id as its logo plus short name on the neutral chip",
    (competition) => {
      const { container } = render(<CompEyebrowChip comp={competition.id} />);
      const chip = container.firstElementChild as HTMLElement;
      expect(chip).toHaveTextContent(competition.shortLabel);
      expect(chip).toHaveClass("text-label", "bg-chip", "text-ink");
      // The short name is printed beside the logo, so the logo is decorative.
      expect(container.querySelector(`[data-competition-logo="${competition.id}"]`)).toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    },
  );
});
