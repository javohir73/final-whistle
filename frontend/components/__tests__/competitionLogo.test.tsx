import { render } from "@testing-library/react";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { CompetitionLogo } from "@/components/CompetitionLogo";

describe("CompetitionLogo", () => {
  it("uses a fixed, transparent box with object-fit contain", () => {
    const { container } = render(<CompetitionLogo competition="epl" size={32} />);
    const shell = container.querySelector('[data-competition-logo="epl"]');
    const img = shell?.querySelector("img");

    expect(shell).toHaveStyle({ width: "32px", height: "32px" });
    expect(shell?.className).not.toMatch(/shadow|ring|bg-|border/);
    expect(img).toHaveAttribute("width", "32");
    expect(img).toHaveAttribute("height", "32");
    expect(img).toHaveStyle({ width: "32px", height: "32px" });
    expect(img).toHaveClass("object-contain");
    expect(img).not.toHaveClass("object-cover");
    expect(img?.className).not.toMatch(/shadow/);
  });

  it("names the logo by default and hides it when decorative", () => {
    const { container, rerender } = render(<CompetitionLogo competition="laliga" />);
    expect(container.querySelector("img")).toHaveAttribute("alt", "La Liga");
    expect(container.querySelector("img")).not.toHaveAttribute("aria-hidden");

    rerender(<CompetitionLogo competition="laliga" decorative />);
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
    expect(container.querySelector("img")).toHaveAttribute("aria-hidden", "true");
  });

  it.each([
    ["epl", "/competitions/epl.svg"],
    ["bundesliga", "/competitions/bundesliga.svg"],
    ["ucl", "/competitions/ucl.svg"],
    ["laliga", "/competitions/laliga.png"],
    ["nrl", "/competitions/nrl.svg"],
  ] as const)("uses the self-hosted %s mark", (id, src) => {
    const { container } = render(<CompetitionLogo competition={id} size={32} />);
    expect(container.querySelector(`[data-competition-logo="${id}"] img`)).toHaveAttribute("src", src);
  });

  it("keeps the owner-supplied World Cup mark with a centred square crop", () => {
    const { container } = render(<CompetitionLogo competition="wc26" size={40} labelled />);
    const image = container.querySelector('[data-competition-logo="wc26"] img');

    expect(image).toHaveAttribute("src", "/competitions/wc26-20260821.png");
    expect(image).toHaveAttribute("alt", "World Cup 2026");
    expect(image).toHaveClass("object-cover", "object-center");
    expect(image).not.toHaveClass("object-contain");

    const bytes = readFileSync(join(process.cwd(), "public/competitions/wc26-20260821.png"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "4c18cc1d14e4fdf3e6aa2e1ec4b066f945a6943cbb807b9cce6c919d166999e4",
    );
  });

  it("can render the World Cup asset on a taller rectangular canvas", () => {
    const { container } = render(
      <CompetitionLogo competition="wc26" size={60} width={84} height={72} fit="cover" labelled />,
    );
    const shell = container.querySelector('[data-competition-logo="wc26"]');
    const image = shell?.querySelector("img");

    expect(shell).toHaveStyle({ width: "84px", height: "72px" });
    expect(image).toHaveAttribute("width", "84");
    expect(image).toHaveAttribute("height", "72");
    expect(image).toHaveClass("object-cover", "object-center");
  });

  it("draws UFC as a round text mark, since it has no logo file", () => {
    const { container, rerender } = render(<CompetitionLogo competition="ufc" size={32} />);
    const shell = container.querySelector('[data-competition-logo="ufc"]');
    expect(shell?.querySelector("img[src]")).toBeNull();
    expect(shell).toHaveTextContent("UFC");
    expect(shell?.querySelector('[role="img"]')).toHaveAttribute("aria-label", "UFC");

    rerender(<CompetitionLogo competition="ufc" size={32} decorative />);
    const hidden = container.querySelector('[data-competition-logo="ufc"]');
    expect(hidden?.querySelector('[role="img"]')).toBeNull();
    expect(hidden?.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
