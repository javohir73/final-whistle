import { render } from "@testing-library/react";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { CompetitionLogo } from "@/components/CompetitionLogo";

describe("CompetitionLogo", () => {
  it("uses a transparent, consistently sized canvas", () => {
    const { container } = render(<CompetitionLogo competition="epl" size={32} />);
    const shell = container.querySelector('[data-competition-logo="epl"]');

    expect(shell).toHaveStyle({ width: "32px", height: "32px" });
    expect(shell).not.toHaveClass("bg-white/95", "ring-1");
    expect(shell?.querySelector("img")).toHaveClass(
      "h-full",
      "w-full",
      "object-contain",
      "p-[4%]",
    );
    expect(shell?.querySelector("img")).not.toHaveClass("object-cover");
  });

  it("uses the owner-supplied World Cup mark with a centered square crop", () => {
    const { container } = render(
      <CompetitionLogo competition="wc26" size={40} labelled />,
    );
    const image = container.querySelector('[data-competition-logo="wc26"] img');

    expect(image).toHaveAttribute("src", "/competitions/wc26.png");
    expect(image).toHaveAttribute("alt", "World Cup 2026 logo");
    expect(image).toHaveClass("object-cover", "object-center", "p-0");
    expect(image).not.toHaveClass("object-contain");

    const bytes = readFileSync(join(process.cwd(), "public/competitions/wc26.png"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "4c18cc1d14e4fdf3e6aa2e1ec4b066f945a6943cbb807b9cce6c919d166999e4",
    );
  });

  it("can render the World Cup asset on a taller rectangular canvas", () => {
    const { container } = render(
      <CompetitionLogo
        competition="wc26"
        size={60}
        width={84}
        height={72}
        fit="cover"
        labelled
      />,
    );
    const shell = container.querySelector('[data-competition-logo="wc26"]');
    const image = shell?.querySelector("img");

    expect(shell).toHaveStyle({ width: "84px", height: "72px" });
    expect(image).toHaveAttribute("width", "84");
    expect(image).toHaveAttribute("height", "72");
    expect(image).toHaveClass("object-cover", "object-center", "p-0");
    expect(image).not.toHaveClass("object-contain");
  });

  it("uses the self-hosted Champions League mark", () => {
    const { container } = render(<CompetitionLogo competition="ucl" size={32} />);
    expect(container.querySelector('[data-competition-logo="ucl"] img')).toHaveAttribute(
      "src",
      "/competitions/ucl.png",
    );
  });
});
