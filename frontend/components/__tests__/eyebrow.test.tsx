import { render, screen } from "@testing-library/react";
// jsdom's CSSOM rejects `hsl(var(--x))` as an unparseable color (it silently
// drops the whole style, live-DOM only) -- react-dom's static-markup renderer
// serializes the style prop as a plain string instead, so it's the only way
// to actually see the inline style this component sets. Used for the
// accent-var assertion below only; the plain-text Eyebrow case renders fine
// through the normal RTL path.
import { renderToStaticMarkup } from "react-dom/server.node";
import { Eyebrow, CompEyebrowChip } from "@/components/Eyebrow";
import { COMPETITIONS, accentInkVar } from "@/lib/sports";

describe("Eyebrow", () => {
  it("renders its text at the 11px a11y floor, uppercased by CSS", () => {
    render(<Eyebrow>Tonight feature</Eyebrow>);
    const label = screen.getByText("Tonight feature");
    expect(label).toHaveClass("uppercase");
    expect(label).toHaveClass("text-label");
  });
});

describe("CompEyebrowChip", () => {
  it.each(Object.values(COMPETITIONS))(
    "renders $id through its registry accent and semantic ink",
    (competition) => {
      const html = renderToStaticMarkup(<CompEyebrowChip comp={competition.id} />);
      expect(html).toContain(`>${competition.shortLabel}<`);
      expect(html).toContain("text-label");
      expect(html).toContain(
        `background-color:hsl(var(${competition.accentVar}) / 0.12)`,
      );
      expect(html).toContain(`color:hsl(var(${accentInkVar(competition.id)}))`);
    },
  );
});
