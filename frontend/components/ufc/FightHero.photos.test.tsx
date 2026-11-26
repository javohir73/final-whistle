import { render, screen } from "@testing-library/react";
import { FightHero } from "./FightHero";
import { SCHEDULED_BOUT } from "./fixtures.testutil";
import { PHOTO } from "./photos.testutil";

jest.mock("@/lib/ufcFighterPhotos", () => ({
  ...jest.requireActual("@/lib/ufcFighterPhotos"),
  fighterPhoto: (slug: string | null | undefined) =>
    slug === "israel-adesanya-4285679" || slug === "jiri-prochazka-3156612"
      ? jest.requireActual("./photos.testutil").PHOTO
      : null,
}));

it("shows a photo for the fighter who has one and the tile for the other", () => {
  const { container } = render(<FightHero bout={SCHEDULED_BOUT} tz="UTC" />);
  const imgs = screen.getAllByRole("img");
  expect(imgs).toHaveLength(1);
  expect(imgs[0]).toHaveAttribute("alt", "Israel Adesanya");
  expect(imgs[0]).toHaveAttribute("src", PHOTO.src);
  expect(screen.getByRole("link", { name: "Photo: Jane Doe, CC BY-SA 4.0" })).toHaveAttribute("href", PHOTO.sourceUrl);
  expect(container.querySelector("[data-side='b'] [data-portrait='tile']")).not.toBeNull();
  expect(container.querySelector("[data-side='a'] [data-portrait='photo']")).not.toBeNull();
});

it("renders the dark band with the eyebrow, vs, country and record pills", () => {
  const { container } = render(<FightHero bout={SCHEDULED_BOUT} tz="UTC" />);
  const band = container.querySelector("section") as HTMLElement;
  expect(band.className).toContain("bg-ufc-band");
  expect(screen.getByText("UFC · Sat 5 Dec · Main card")).toHaveClass("text-ufc-lime");
  expect(screen.getByText("vs")).toBeInTheDocument();
  expect(screen.getByText("New Zealand")).toBeInTheDocument();
  expect(screen.getByText("24-6-0")).toBeInTheDocument();
});

it("renders every portrait as a tile when no fighter has a photo", () => {
  const bout = { ...SCHEDULED_BOUT, fighter_a: { ...SCHEDULED_BOUT.fighter_a, slug: "other-1" } };
  const { container } = render(<FightHero bout={bout} tz="UTC" />);
  expect(screen.queryByRole("img")).toBeNull();
  expect(container.querySelectorAll("[data-portrait='tile']")).toHaveLength(2);
});
