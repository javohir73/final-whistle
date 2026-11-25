import { render } from "@testing-library/react";
import { BoutRow } from "./BoutRow";
import { UPCOMING_EVENT } from "./fixtures.testutil";

jest.mock("@/lib/ufcFighterPhotos", () => ({
  ...jest.requireActual("@/lib/ufcFighterPhotos"),
  fighterPhoto: (slug: string | null | undefined) =>
    slug === "israel-adesanya-4285679" || slug === "jiri-prochazka-3156612"
      ? jest.requireActual("./photos.testutil").PHOTO
      : null,
}));

const main = UPCOMING_EVENT.segments[0].bouts[0];

it("swaps the monogram for a round headshot of exactly the same size", () => {
  const { container } = render(<BoutRow bout={main} tz="UTC" isMainEvent={false} />);
  const shot = container.querySelector("[data-fighter-photo]") as HTMLElement;
  expect(shot).not.toBeNull();
  expect(shot.tagName).toBe("SPAN");
  expect(shot.style.width).toBe("26px");
  expect(shot.style.height).toBe("26px");
  expect(shot.className).toContain("rounded-full");
  const img = shot.querySelector("img") as HTMLImageElement;
  expect(img).toHaveAttribute("alt", "");
  expect(img).toHaveAttribute("aria-hidden", "true");
  expect(img.className).toContain("object-cover");
  expect(img.style.objectPosition).toBe("center 18%");
  // The other fighter has no photo: still the 26px monogram, and the same inline-sized span the
  // narrow-phone rules (22px under 370px) resize.
  const spans = container.querySelectorAll("a span[style]");
  const marks = Array.from(spans).filter((s) => (s as HTMLElement).style.width === "26px");
  expect(marks).toHaveLength(2);
  const row = shot.closest("[class*='max-[370px]']") as HTMLElement;
  expect(row.className).toContain("max-[370px]:[&_span[style]]:!w-[22px]");
  expect(row.className).toContain("max-[370px]:[&_span[style]]:!h-[22px]");
});
